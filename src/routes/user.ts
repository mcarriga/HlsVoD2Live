import express, {NextFunction, Request, Response, Router} from 'express';
import {stringify} from "hls-parser";
import {
    getAudioRenditionManifest,
    getCaptionsRenditionManifest,
    getSubtitleRenditionManifest,
    getVariantManifest, getVideoRenditionManifest,
    MyRequest,
    vod
} from "../app";
import {VodHlsObject} from "../VodHlsObject";
import {Vod2LiveRequest} from "../interfaces";
import {cloneMediaPlaylistWithoutSegments, createSegments} from "../appHelpers";

let router:Router = express.Router();

router.get('/:name/master.m3u8', function (request: MyRequest, response: Response, next: NextFunction) {
    let usr = request.params['name'];
    console.log('usr: ' + usr);
    response.status(200).contentType("application/x-mpegURL");
    response.set('Content-Type', "application/x-mpegURL");
    response.send(stringify(vod._master));
});

const startPlaylistWriting = (vod: VodHlsObject, item: Vod2LiveRequest) => {
    for (let [variant, playlist] of vod._variants) {
        router.get('/:name/' + variant.uri, getVariantManifest);
    }

    for (let [rendition, playlist] of vod._audio) {
        router.get('/:name/' + rendition.uri, getAudioRenditionManifest);
    }

    for (let [rendition, playlist] of vod._subtitles) {
        router.get('/:name/' + rendition.uri, getSubtitleRenditionManifest);
    }

    for (let [rendition, playlist] of vod._captions) {
        router.get('/:name/' + rendition.uri, getCaptionsRenditionManifest);
    }

    for (let [rendition, playlist] of vod._video) {
        router.get('/:name/' + rendition.uri, getVideoRenditionManifest);
    }
}

module.exports = router;
