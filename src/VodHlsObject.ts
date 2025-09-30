import {types, parse, stringify} from "hls-parser";
import Variant = types.Variant;
import MediaPlaylist = types.MediaPlaylist;
import Rendition = types.Rendition;
import MasterPlaylist = types.MasterPlaylist;
import axios from 'axios';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {start} from "repl";
import DateRange = types.DateRange;
import {cloneMediaPlaylistWithoutSegments, cloneSegment} from "./appHelpers";

export class VodHlsObject {
    _startDate: Date;
    _url: string;
    _master: MasterPlaylist;
    _variants: Map<Variant, MediaPlaylist> = new Map();
    _audio: Map<Rendition, MediaPlaylist> = new Map();
    _subtitles: Map<Rendition, MediaPlaylist> = new Map();
    _captions: Map<Rendition, MediaPlaylist> = new Map();
    _video: Map<Rendition, MediaPlaylist> = new Map();
    _pdtDiscos: boolean = true;
    _originalPdt:Date = undefined;
    _dvrWindowSeconds: number;

    constructor(url: string, addPdtToDiscos?: boolean, startDate?: Date, dvrWindowSeconds?:number) {
        this._url = url;
        if(addPdtToDiscos) this._pdtDiscos = addPdtToDiscos;
        this._dvrWindowSeconds = dvrWindowSeconds? dvrWindowSeconds : undefined;
        if(startDate) {
            this._startDate = startDate
        } else {
            console.log('else: ' + this._dvrWindowSeconds);
            if (this._dvrWindowSeconds && this._dvrWindowSeconds > 0) {
                let window: number = (this._dvrWindowSeconds as number * 100000);
                console.log('window is ' + window);
                this._startDate  = new Date(new Date().getTime() - window);
            } else {
                this._startDate  = new Date();
            }
        }
    }

    async init(): Promise<VodHlsObject>{
        let promises: Promise<any>[] = [];
        await getHlsMasterManifest(new URL(this._url)).then(playlist => {
            this._master = playlist;
        }).catch(err => {

        });
        let videoVariants = this._master.variants;
        let allUniqueAudioUris: string[] = [];
        let uniqueAudioTracks:{uri: string, groupId: string, name:string}[] = [];

        let allUniqueSubtitleUris: string[] = [];
        let uniqueSubtitleTracks:{uri: string, groupId: string, name:string}[] = [];

        let allUniqueCaptionUris: string[] = [];
        let uniqueCaptionTracks:{uri: string, groupId: string, name:string}[] = [];

        let allUniqueVideoUris: string[] = [];
        let uniqueVideoTracks:{uri: string, groupId: string, name:string}[] = [];

        for (let vid of videoVariants) {
            vid.uri = resolve(new URL(this._url).href, vid.uri);
            console.log('video variant: ' + vid.uri);
            await getHlsVariantManifest(new URL(vid.uri)).then(playlist => {
                preparePlaylist(playlist, new URL(vid.uri), this._startDate, this).then(() => {
                    this._variants.set(vid, playlist);
                });
            }).catch(err => {

            });
            promises.push(this.parseAudioRenditions(vid, allUniqueAudioUris, uniqueAudioTracks));
            promises.push(this.parseCaptionsRenditions(vid, allUniqueCaptionUris, uniqueCaptionTracks));
            promises.push(this.parseSubtitleRenditions(vid, allUniqueSubtitleUris, uniqueSubtitleTracks));
            promises.push(this.parseVideoRenditions(vid, allUniqueVideoUris, uniqueVideoTracks));
            //await Promise.all(promises);
            //promises = [];
        }

        await Promise.all(promises);
        await this.normalizeRenditionRelationships();
        await this.rewritePlaylistUris();
        console.log('Done rewriting - returning');
        return this;
    }

    correctSubs(playlist: MediaPlaylist){
        let videoTarget = Array.from(this._variants.values())[0].targetDuration;
        if ((playlist.targetDuration * 2) > videoTarget) {
            let newPlaylist = cloneMediaPlaylistWithoutSegments(playlist);
            for (let seg of playlist.segments) {
                let iters = Math.floor(seg.duration / videoTarget);
                let remainder = seg.duration % videoTarget;
                for (let i = 0; i<iters; i++) {
                    let newSegment = cloneSegment(seg, videoTarget);
                    // @ts-ignore
                    newPlaylist.segments.push(newSegment);
                }
                if (remainder > 0) {
                    let newSegment = cloneSegment(seg, remainder);
                    // @ts-ignore
                    newPlaylist.segments.push(newSegment);
                }
            }
            return newPlaylist;
        }
    }

    async parseAudioRenditions(vid: Variant, allUniqueAudioUris: string[], uniqueAudioTracks:{uri: string, groupId: string, name:string}[] ): Promise<void> {

        for (let audio of vid.audio) {
            audio.uri = resolve(new URL(this._url).href, audio.uri);
            //console.log('audio rendition: ' + audio.uri);
            let found = false;
            for (let object of uniqueAudioTracks) {
                if (object.groupId == audio.groupId && object.uri == audio.uri && object.name == audio.name){
                    found = true;
                }
            }
            if (!found) {
                console.log('new Audio Found: ' + audio.uri + ' ::: ' + audio.groupId + ' ::: ' + audio.name);
                allUniqueAudioUris.push(audio.uri);
                uniqueAudioTracks.push({uri: audio.uri, groupId: audio.groupId, name: audio.name});
                return getHlsVariantManifest(new URL(audio.uri)).then(playlist => {
                    preparePlaylist(playlist, new URL(audio.uri), this._startDate, this).then(() => {
                        this._audio.set(audio, playlist);
                    });
                }).catch(err => {

                });
            }
        }
    }

    async parseSubtitleRenditions(vid: Variant, allUniqueSubtitleUris: string[], uniqueSubtitleTracks:{uri: string, groupId: string, name:string}[]): Promise<void> {

        for (let subtitle of vid.subtitles) {
            subtitle.uri = resolve(new URL(this._url).href, subtitle.uri);
            //console.log('subtitle rendition: ' + subtitle.uri);

            let found = false;
            for (let object of uniqueSubtitleTracks) {
                if (object.groupId == subtitle.groupId && object.uri == subtitle.uri && object.name == subtitle.name){
                    found = true;
                }
            }
            if (!found) {
                allUniqueSubtitleUris.push(subtitle.uri);
                uniqueSubtitleTracks.push({uri: subtitle.uri, groupId: subtitle.groupId, name: subtitle.name});
                return getHlsVariantManifest(new URL(subtitle.uri)).then(playlist => {
                    playlist = this.correctSubs(playlist);
                    preparePlaylist(playlist, new URL(subtitle.uri), this._startDate, this).then(() => {
                        this._subtitles.set(subtitle, playlist);
                    });
                }).catch(err => {

                });
            }
        }
    }

    async parseCaptionsRenditions(vid: Variant, allUniqueCaptionUris: string[], uniqueCaptionTracks:{uri: string, groupId: string, name:string}[]): Promise<void> {

        for (let caption of vid.closedCaptions) {
            caption.uri = resolve(new URL(this._url).href, caption.uri);
            let found = false;

            for (let object of uniqueCaptionTracks) {
                if (object.groupId == caption.groupId && object.uri == caption.uri && object.name == caption.name){
                    found = true;
                }
            }

            if (!found) {
                allUniqueCaptionUris.push(caption.uri);
                uniqueCaptionTracks.push({uri: caption.uri, groupId: caption.groupId, name: caption.name});
                return getHlsVariantManifest(new URL(caption.uri)).then(playlist => {
                    preparePlaylist(playlist, new URL(caption.uri), this._startDate, this).then(() => {
                        this._captions.set(caption, playlist);
                    });
                }).catch(err => {

                });
            }
        }
    }

    async parseVideoRenditions(vid: Variant, allUniqueVideoUris: string[], uniqueVideoTracks:{uri: string, groupId: string, name:string}[]): Promise<void> {

        for (let video of vid.video) {
            video.uri = resolve(new URL(this._url).href, video.uri);
            let found = false;

            for (let object of uniqueVideoTracks) {
                if (object.groupId == video.groupId && object.uri == video.uri && object.name == video.name){
                    found = true;
                }
            }

            if (!found) {
                allUniqueVideoUris.push(video.uri);
                uniqueVideoTracks.push({uri: video.uri, groupId: video.groupId, name: video.name});
                return getHlsVariantManifest(new URL(video.uri)).then(playlist => {
                    preparePlaylist(playlist, new URL(video.uri), this._startDate, this).then(() => {
                        this._video.set(video, playlist);
                    });
                }).catch(err => {

                });
            }
        }
    }

    async normalizeRenditionRelationships(): Promise<void> {
        // Due to the Object-oriented nature of the hls-parser library, each Variant gets a unique object for each audio and subtitle.
        // So even though variants should be sharing audio/subtitle Renditions of the same group/name; they each end up getting their own which
        // creates LOTS of duplicates. The below code loops through each Video Variant, and then loops through the Audio and Subtitle Renditions
        // and finds an existing Renditions that already matches the same groupid/name and then re-assigns the variants Audio/Subtitle renditions
        // to that reference Object in memory - This is because JS objects are usually pass-by-reference
        for (let [variant, playlist] of this._variants) {
            for (let i=0; i< variant.audio.length; i++) {
                let audio = variant.audio[i];
                for (let [a, p] of this._audio) {
                    if (a.name == audio.name && a.groupId == audio.groupId) {
                        console.log('overriding audio');
                        // @ts-ignore
                        variant.audio[i] = a;
                    }
                }
            }
            for (let i=0; i< variant.subtitles.length; i++) {
                let subtitle = variant.subtitles[i];
                for (let [s, p] of this._subtitles) {
                    if (s.name == subtitle.name && s.groupId == subtitle.groupId) {
                        // @ts-ignore
                        variant.subtitles[i] = s;
                    }
                }
            }
            for (let i=0; i< variant.closedCaptions.length; i++) {
                let caption = variant.closedCaptions[i];
                for (let [c, p] of this._captions) {
                    if (c.name == caption.name && c.groupId == caption.groupId) {
                        // @ts-ignore
                        variant.closedCaptions[i] = c;
                    }
                }
            }
            for (let i=0; i< variant.video.length; i++) {
                let video = variant.video[i];
                for (let [v, p] of this._video) {
                    if (v.name == video.name && v.groupId == video.groupId) {
                        // @ts-ignore
                        variant.video[i] = v;
                    }
                }
            }
        }
    }

    async rewritePlaylistUris(): Promise<void> {
        let videoVariants = this._master.variants;
        console.log('Video Variants: ' + videoVariants.length);
        for (let vid of videoVariants) {
            let u = new URL(vid.uri);
            let id = uuidv4();
            vid.uri = '/' + id + '.' + path.basename(vid.uri);
            //vid.uri = '/' + path.basename(vid.uri);
            //console.log('new video variant uri: ' + vid.uri);
            //console.log('relative?: ' + u.pathname);
        }

        console.log('Audio Renditions: ' + this._audio.size);
        for (let [rendition, playlist] of this._audio) {
            let u = new URL(rendition.uri);
            let id = uuidv4();
            rendition.uri = '/' + id + '.' + path.basename(rendition.uri);
            //rendition.uri = '/' + path.basename(rendition.uri);
            //console.log('new audio rendition uri: ' + rendition.uri);
            //console.log('relative?: ' + u.pathname);
        }

        console.log('Subtitle Renditions: ' + this._subtitles.size);
        for (let [rendition, playlist] of this._subtitles) {
            let u = new URL(rendition.uri);
            let id = uuidv4();
            rendition.uri = '/' + id + '.' + path.basename(rendition.uri);
            //rendition.uri = '/' + path.basename(rendition.uri);
            //console.log('new subtitle rendition uri: ' + rendition.uri);
        }
        for (let [rendition, playlist] of this._captions) {
            let u = new URL(rendition.uri);
            let id = uuidv4();
            rendition.uri = '/' + id + '.' + path.basename(rendition.uri);
            //rendition.uri = '/' + path.basename(rendition.uri);
            //console.log('new caption rendition uri: ' + rendition.uri);
        }
        for (let [rendition, playlist] of this._video) {
            let u = new URL(rendition.uri);
            let id = uuidv4();
            rendition.uri = '/' + id + '.' + path.basename(rendition.uri);
            //rendition.uri = '/' + path.basename(rendition.uri);
            //console.log('new video rendition uri: ' + rendition.uri);
        }
    }

}

async function getHlsMasterManifest(url: URL): Promise<MasterPlaylist> {
    try {
        let response = await axios.get(url.href);
        let index = await parse(response.data) as MasterPlaylist;
        return index;
    } catch (err) {
        throw err;
    }
}

export async function getHlsVariantManifest(url: URL): Promise<MediaPlaylist> {
    try {
        let response = await axios.get(url.href);
        let index = await parse(response.data) as MediaPlaylist;
        return index;
    } catch (err) {
        throw err;
    }
}

export async function preparePlaylist(playlist: MediaPlaylist, variantUri: URL, startDate: Date, vod: VodHlsObject, resetPdt:boolean = false) {
    playlist.endlist = false;
    playlist.playlistType = (vod._dvrWindowSeconds && vod._dvrWindowSeconds == -1)? 'EVENT' : undefined;
    if(!playlist.segments[0].programDateTime) {
        playlist.segments[0].programDateTime = new Date(startDate.getTime());
    } else {
        vod._originalPdt = new Date(playlist.segments[0].programDateTime.getTime());
        //startDate = playlist.segments[0].programDateTime;
        //vod._startDate = playlist.segments[0].programDateTime;
        playlist.segments[0].programDateTime = startDate;
        console.log(`mcarriga else new PDT: ${playlist.segments[0].programDateTime} - original was vod._originalPdt`);
    }

    //playlist.discontinuitySequenceBase = 0;
    //playlist.mediaSequenceBase = playlist.segments[0].mediaSequenceNumber;
    await prepareSegments(playlist, variantUri, startDate, vod, resetPdt);
}

export async function prepareSegments(playlist: MediaPlaylist, variantUri: URL, startDate: Date, vod: VodHlsObject, resetPdt:boolean = false){
    let totalDur = 0;
    if (resetPdt) totalDur = playlist.segments[playlist.segments.length-1]['_totalDuration'];
    let iterDur = 0;

    console.log('prepareSegments.totalDur = ' + totalDur);
    for (let segment of playlist.segments) {
        if (variantUri) {
            segment.uri = resolve(variantUri.href, segment.uri);
        }

        if (segment.key && segment.key.uri) {
            segment.key.uri = resolve(variantUri.href, segment.key.uri);
        }

        segment['_pdt'] = new Date(startDate.getTime() + (iterDur * 1000));
        if (resetPdt && segment.programDateTime) {
            segment.programDateTime = undefined;
            segment.mediaSequenceNumber = segment.mediaSequenceNumber + playlist.segments[playlist.segments.length -1].mediaSequenceNumber + 1;
        }
        segment['_totalDuration'] = totalDur;
        totalDur = totalDur + segment.duration;
        iterDur = iterDur + segment.duration;
        if (segment.dateRange && segment.dateRange.start && vod._originalPdt && vod._originalPdt.getTime() < segment['_pdt'].getTime()) {
            let diff = startDate.getTime() - vod._originalPdt.getTime()
            segment.dateRange.start = new Date(segment.dateRange.start.getTime() + diff);
        }
    }
    if (resetPdt) {
        playlist.segments[0].discontinuity = true;
        playlist.segments[0].programDateTime = playlist.segments[0]['_pdt'];
    }
}

export function resolve(from:string, to:string): string {
    const resolvedUrl = new URL(to, new URL(from, 'resolve://'));
    if (resolvedUrl.protocol === 'resolve:') {
        // `from` is a relative URL.
        const { pathname, search, hash } = resolvedUrl;
        return pathname + search + hash;
    }
    return resolvedUrl.toString();
}
