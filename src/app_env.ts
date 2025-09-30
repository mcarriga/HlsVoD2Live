import express, { Request, Response, NextFunction } from 'express';
import {stringify, types} from "hls-parser";
import MediaPlaylist = types.MediaPlaylist;
import {VodHlsObject} from "./VodHlsObject";
import ngrok from 'ngrok';
import dotenv from "dotenv"
import {
    initialize, serverStarted
} from "./app";
import {StartOffset, Vod2LiveRequest} from "./interfaces";
var httpMocks = require('node-mocks-http');

dotenv.config()
//const app = express();
//const port = 3000;

let dvrWindowSeconds:number = process.env.dvr_window_seconds? Number(process.env.DvrWindowSeconds) : 40;
let addPdtToDiscos: boolean = (process.env.add_pdt_to_discontinuities === 'true')? true : false;
let liveEdgeDistanceSegmentCount:number = Number(process.env.live_edge_segments);
let useNgrok: boolean = (process.env.use_ngrok === 'true')? true: false
let ngrokAuthToken:string = process.env.ngrok_auth_token;
let start:StartOffset = undefined; //{offset: Number(process.env.startOffset), precise: Boolean(process.env.startPrecise)};
if (process.env.startOffset && process.env.startOffset != '' && process.env.startPrecise && (process.env.startPrecise === 'true' || process.env.startPrecise === 'false')) {
    start = {offset: Number(process.env.startOffset), precise: Boolean(process.env.startPrecise)};
}
let vodManifestUrl:string = process.env.stream_url;
let pdtStart:Date = (process.env.pdt && process.env.pdt != "" && process.env.pdt)? new Date() : undefined;

let req: Vod2LiveRequest = {
    stream_url: vodManifestUrl,
    dvr_window_seconds: dvrWindowSeconds,
    add_pdt_to_discontinuities: addPdtToDiscos,
    live_edge_segments: liveEdgeDistanceSegmentCount,
}
if (pdtStart) req.pdt_start = pdtStart.toISOString();
if (useNgrok) req.ngrok_config = {enabled: true, auth_token: ngrokAuthToken};
if (start) req.start_offset = start

serverStarted.then(() => {
    let request = httpMocks.createRequest({
        method: 'POST',
        url: '/init',
        body: JSON.parse(JSON.stringify(req))
    });
    let response = httpMocks.createResponse();
    initialize(request, response, undefined);
});
