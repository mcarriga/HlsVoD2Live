import {Vod2LiveRequest} from "./interfaces";
import {types} from "hls-parser";
import MediaPlaylist = types.MediaPlaylist;
import Segment = types.Segment;
import {preparePlaylist, VodHlsObject} from "./VodHlsObject";
import ngrok from "ngrok";

export const addNgrokProxy = async (item: Vod2LiveRequest, port: number):Promise<string> => {
    if(item.ngrok_config && item.ngrok_config.enabled === true) {
        let config: ngrok.Ngrok.Options = {proto: 'http', addr: port};
        if(item.ngrok_config.auth_token) config.authtoken = item.ngrok_config.auth_token;
        ngrok.connect(config).then(url => {
            console.log('stream available at ' + url + '/master.m3u8');
            return  url;
        });
    } else {
        return undefined;
    }
}

export function cloneMediaPlaylistWithoutSegments(playlist: MediaPlaylist): MediaPlaylist {
    let cloned = new MediaPlaylist({
        targetDuration: playlist.targetDuration,
        start: playlist.start,
        playlistType: playlist.playlistType,
        partTargetDuration: playlist.partTargetDuration,
        mediaSequenceBase: playlist.mediaSequenceBase,
        lowLatencyCompatibility: playlist.lowLatencyCompatibility,
        isIFrame: playlist.isIFrame,
        discontinuitySequenceBase: playlist.discontinuitySequenceBase,
        source: playlist.source,
        prefetchSegments: playlist.prefetchSegments,
        renditionReports: playlist.renditionReports,
        independentSegments: playlist.independentSegments,
        endlist: playlist.endlist,
        version: playlist.version,
        uri: playlist.uri,
        skip: playlist.skip,
        segments: []
    });
    return cloned
}

export function cloneSegment(segment: Segment, newDuration?: number) {
    let cloned = new Segment({
        parts: segment.parts,
        dateRange: segment.dateRange,
        mediaSequenceNumber: segment.mediaSequenceNumber,
        byterange: segment.byterange,
        map: segment.map,
        programDateTime: segment.programDateTime,
        discontinuitySequence: segment.discontinuitySequence,
        discontinuity: segment.discontinuity,
        title: segment.title,
        key: segment.key,
        uri: segment.uri,
        duration: newDuration? newDuration : segment.duration,
    });
    cloned['_pdt'] = segment['_pdt'];
    cloned['_totalDuration'] = segment['_totalDuration'];
    return cloned;
}

export async function createSegments(originalPlaylist: MediaPlaylist, playlistUri: string, variantOrRenditionMap: Map<String, MediaPlaylist>, request: Vod2LiveRequest, vod: VodHlsObject){
    let livePlaylist = variantOrRenditionMap.get(playlistUri);
    let i = 0;

    if (request.startSegmentOffset) {
        console.log('Using startSegmentOffset of ' + request.startSegmentOffset + ' for ' + playlistUri);
        for (i; i<request.startSegmentOffset; i++) {
            let segment = cloneSegment(originalPlaylist.segments[i]);
            segment.programDateTime = segment['_pdt'];

            livePlaylist.segments.push(segment);

            let pdt = segment['_pdt'];
            let totalDur = segment['_totalDuration'];
            //console.log('currSegment TotalDur: ' + totalDur + " ::: LivePlaylist firstSegment TotalDur: " + livePlaylist.segments[0]['_totalDuration']);
            //console.log('totalDuration difference: ' + (totalDur - livePlaylist.segments[0]['_totalDuration']) +  ' ::: dvrWindow + segDur: ' + (request.dvr_window_seconds + originalPlaylist.segments[i+1].duration));
            if(originalPlaylist.segments[i+1] && totalDur - livePlaylist.segments[0]['_totalDuration'] >= request.dvr_window_seconds + originalPlaylist.segments[i+1].duration) {
                if (request.dvr_window_seconds != -1) {
                    // @ts-ignore
                    let dropped:Segment = livePlaylist.segments.shift(); // Drops the earliest segment off of the playlist.. -1 indicates EVENT
                    //console.log('dropped segment: ' + dropped.uri);
                }
                livePlaylist.segments[0].programDateTime = livePlaylist.segments[0]['_pdt']; // The NEW first segment of the playlist should include a PDT for LIVE/EVENT
                livePlaylist.mediaSequenceBase = livePlaylist.segments[0].mediaSequenceNumber; // when Dropping a segment, the MediaSequenceBase of the Playlist needs to be updated
            }

        }

    }

    for (i; i<originalPlaylist.segments.length; i++) {
        let segment = cloneSegment(originalPlaylist.segments[i]);
        segment.programDateTime = segment['_pdt'];
        if (i < 1) {
            // @ts-ignore
            livePlaylist.segments.push(segment);
        } else {
            await new Promise(resolve => setTimeout(resolve, originalPlaylist.segments[i-1].duration * 1000)).then(() => {
                // @ts-ignore
                livePlaylist.segments.push(segment);

                if (i == originalPlaylist.segments.length -1) { // last segment - need to add ENDLIST tag
                    if (request.infinite_replay === true) {
                        console.log('Hit the end of the playlist and need infinite loop. Using startDate as ' + segment['_pdt']);
                        preparePlaylist(originalPlaylist, undefined, segment['_pdt'], vod, true).then(() => {
                            console.log('Setting first Segment to be a discontinuity');
                            originalPlaylist.segments[0].discontinuity = true;
                        });
                        i = -1;
                    } else {
                        //console.log('Hit the end of the playlist and need to finish loop for ' + playlistUri);
                        livePlaylist.endlist = true;
                    }
                }
                let pdt = segment['_pdt'];
                let totalDur = segment['_totalDuration'];
                //console.log('currSegment TotalDur: ' + totalDur + " ::: LivePlaylist firstSegment TotalDur: " + livePlaylist.segments[0]['_totalDuration']);
                //console.log('totalDuration difference: ' + (totalDur - livePlaylist.segments[0]['_totalDuration']) +  ' ::: dvrWindow + segDur: ' + (request.dvr_window_seconds + originalPlaylist.segments[i+1].duration));
                if(originalPlaylist.segments[i+1] && totalDur - livePlaylist.segments[0]['_totalDuration'] >= request.dvr_window_seconds + originalPlaylist.segments[i+1].duration) {
                    if (request.dvr_window_seconds != -1) {
                        
                        let dropped:Segment = livePlaylist.segments.shift(); // Drops the earliest segment off of the playlist.. -1 indicates EVENT
                        //console.log('dropped segment: ' + dropped.uri);
                    }
                    livePlaylist.segments[0].programDateTime = livePlaylist.segments[0]['_pdt']; // The NEW first segment of the playlist should include a PDT for LIVE/EVENT
                    livePlaylist.mediaSequenceBase = livePlaylist.segments[0].mediaSequenceNumber; // when Dropping a segment, the MediaSequenceBase of the Playlist needs to be updated
                }
            });
        }
    }
}

