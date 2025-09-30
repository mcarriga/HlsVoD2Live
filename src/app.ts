import express, {NextFunction, Request, Response} from 'express';
import bodyParser from 'body-parser';
import {stringify, types} from "hls-parser";
import {preparePlaylist, VodHlsObject} from "./VodHlsObject";
import ngrok from 'ngrok';
import dotenv from "dotenv"
import {EventEmitter} from "events";
import {Vod2LiveRequest, Vod2LiveResponse} from "./interfaces";
import MediaPlaylist = types.MediaPlaylist;
import cors from 'cors'
import Segment = types.Segment;
import session from 'express-session';
import {v4} from "uuid";
import {addNgrokProxy, cloneMediaPlaylistWithoutSegments, createSegments} from "./appHelpers";

export interface MyRequest extends Request {
    session: any;
}

const myEmitter = new EventEmitter();
const MemoryStore = require('memorystore')(session)
export let vod:VodHlsObject;

dotenv.config()
const app = express();

app.use(bodyParser.json());
app.use(cors({
    origin: 'http://localhost:3035'
}));

app.use(
    session({
        secret: v4(),
        saveUninitialized: true,
        resave: true,
        store: new MemoryStore({
            checkPeriod: 7200000 // prune expired entries every 2h
        }),
    }));


let usersRouter = require('./routes/user');
app.use('/user', usersRouter);
const port = 3000;
let failed = 'failed';
let success = 'success';

export let serverStarted: Promise<void> =  new Promise((resolve, reject) => {
    myEmitter.once('serverstarted', () => {
        resolve();
    })
});

let videoVariants: Map<String, MediaPlaylist> = new Map<String, MediaPlaylist>();
let audioRenditions: Map<String, MediaPlaylist> = new Map<String, MediaPlaylist>();
let subtitleRenditions: Map<String, MediaPlaylist> = new Map<String, MediaPlaylist>();
let captionsRenditions: Map<String, MediaPlaylist> = new Map<String, MediaPlaylist>();
let videoRenditions: Map<String, MediaPlaylist> = new Map<String, MediaPlaylist>();

const checkSession = (request: MyRequest) => {
    if (!request.session || !request.session['id']) {
        request.session['id'] = v4();
        console.log(request.session['id']);
    } else {
        console.log(request.session['id']);
    }
}

export const check = (request: Request, response: Response, next: NextFunction) => {
    console.log('Status Check');
    response.send('Yep, I\'m alive!');
}

export const createSession = (request: MyRequest, response: Response, next: NextFunction) => {
    checkSession(request);

}

export const initialize = async (request: MyRequest, response: Response, next: NextFunction) => {
    console.log('init');

    // Validate stream url
    if (!request.body || request.body == '' || !request.body.hasOwnProperty('stream_url')) {
        response.status(400).contentType("application/x-mpegURL");
        response.set('Content-Type', "application/x-mpegURL");
        var respBody: Vod2LiveResponse = {
            status: failed,
            local_stream: '',
            errors: ['No stream_url property']
        }
        response.send(JSON.stringify(respBody));
    }
    let errors:Error[] = [];
    console.log(request.body);

    //parse request
    const item: Vod2LiveRequest = request.body;
    console.log('ngrok: ' + JSON.stringify(item.ngrok_config));
    let startDate: Date = undefined;
    if(item.pdt_start && !isNaN(Date.parse(item.pdt_start))){
        startDate = new Date(item.pdt_start);
    }

    // init VodHlsObject
    let addPdt = item.add_pdt_to_discontinuities? item.add_pdt_to_discontinuities : false;
    vod = new VodHlsObject(item.stream_url, addPdt, startDate, item.dvr_window_seconds);
    let ngrokUrl: Promise<string>;

    try {
        vod = await vod.init();
        // reverse proxy handling
        ngrokUrl = addNgrokProxy(item, port);

        // master manifest endpoint
        const getMasterManifest = (request: MyRequest, response: Response, next: NextFunction) => {
            checkSession(request);
            response.status(200).contentType("application/x-mpegURL");
            response.set('Content-Type', "application/x-mpegURL");
            response.send(stringify(vod._master));
        };
        app.get('/master.m3u8', getMasterManifest);

        // Start writing variant/media playlists
        startPlaylistWriting(vod, item);
    } catch (e) {
        errors.push(new Error(e));
        console.log('got error: ');
        console.log(e);
    } finally {
        //Send Response
        response.status(200).contentType("application/json");
        response.set('Content-Type', "application/json");
        var respBody: Vod2LiveResponse = {
            status: success,
            local_stream: 'http://localhost:3000/master.m3u8'
        }
        if (ngrokUrl) respBody.ngrok_stream = await ngrokUrl;
        if (errors.length > 0) {
            let errorStrings: string[] = [];
            for (let error of errors) {
                errorStrings.push(error.message);
            }
        }
        response.send(JSON.stringify(respBody));
    }
};

const startServer = async () => {
    const listen = (prt: number) => {
        return new Promise(((resolve, reject) => {
            app.listen(port, () => {
                console.log(`Application is running on port ${port}.`);
                resolve('http://localhost:3000');
            });
        }));
    }
    await listen(port).then(() => {
        app.post('/init', initialize);
        app.get('/check', check)
    }).catch(err => {

    });
}

startServer().then(() => {
    myEmitter.emit('serverstarted');
});

const startPlaylistWriting = (vod: VodHlsObject, item: Vod2LiveRequest) => {
    for (let [variant, playlist] of vod._variants) {
        let livePlaylist = cloneMediaPlaylistWithoutSegments(playlist)
        if(item.start_offset) livePlaylist.start = item.start_offset;
        videoVariants.set(variant.uri, livePlaylist);
        createSegments(playlist, variant.uri, videoVariants, item, vod);
        app.get(variant.uri, getVariantManifest);
    }

    for (let [rendition, playlist] of vod._audio) {
        let livePlaylist = cloneMediaPlaylistWithoutSegments(playlist);
        if(item.start_offset) livePlaylist.start = item.start_offset;
        audioRenditions.set(rendition.uri, livePlaylist);
        createSegments(playlist, rendition.uri, audioRenditions, item, vod);
        app.get(rendition.uri, getAudioRenditionManifest);
    }

    for (let [rendition, playlist] of vod._subtitles) {
        let livePlaylist = cloneMediaPlaylistWithoutSegments(playlist);
        if(item.start_offset) livePlaylist.start = item.start_offset;
        subtitleRenditions.set(rendition.uri, livePlaylist);
        createSegments(playlist, rendition.uri, subtitleRenditions, item, vod);
        app.get(rendition.uri, getSubtitleRenditionManifest);
    }

    for (let [rendition, playlist] of vod._captions) {
        let livePlaylist = cloneMediaPlaylistWithoutSegments(playlist);
        if(item.start_offset) livePlaylist.start = item.start_offset;
        captionsRenditions.set(rendition.uri, livePlaylist);
        createSegments(playlist, rendition.uri, captionsRenditions, item, vod);
        app.get(rendition.uri, getCaptionsRenditionManifest);
    }

    for (let [rendition, playlist] of vod._video) {
        let livePlaylist = cloneMediaPlaylistWithoutSegments(playlist);
        if(item.start_offset) livePlaylist.start = item.start_offset;
        videoRenditions.set(rendition.uri, livePlaylist);
        createSegments(playlist, rendition.uri, videoRenditions, item, vod);
        app.get(rendition.uri, getVideoRenditionManifest);
    }
}

export const getVariantManifest = (request: MyRequest, response: Response, next: NextFunction) => {
    //console.log('requested: ' + request.path);
    let mediaPlaylist = videoVariants.get(request.path);
    response.status(200).contentType("application/x-mpegURL");
    response.set('Content-Type', "application/x-mpegURL");
    response.send(stringify(mediaPlaylist));
};

export const getAudioRenditionManifest = (request: MyRequest, response: Response, next: NextFunction) => {
    //console.log('requested: ' + request.path);
    let mediaPlaylist = audioRenditions.get(request.path);
    if (mediaPlaylist) {
        response.status(200).contentType("application/x-mpegURL");
        response.set('Content-Type', "application/x-mpegURL");
        response.send(stringify(mediaPlaylist));
    } else {
        // TODO handle no Audio Rendition Playlist found
    }
};

export const getSubtitleRenditionManifest = (request: MyRequest, response: Response, next: NextFunction) => {
    //console.log('requested: ' + request.path);
    let mediaPlaylist = subtitleRenditions.get(request.path);
    if (mediaPlaylist) {
        response.status(200).contentType("application/x-mpegURL");
        response.set('Content-Type', "application/x-mpegURL");
        response.send(stringify(mediaPlaylist));
    } else {
        // TODO handle no Subtitle Rendition Playlist found
    }
};

export const getCaptionsRenditionManifest = (request: MyRequest, response: Response, next: NextFunction) => {
    //console.log('requested: ' + request.path);
    let mediaPlaylist = captionsRenditions.get(request.path);
    if (mediaPlaylist) {
        response.status(200).contentType("application/x-mpegURL");
        response.set('Content-Type', "application/x-mpegURL");
        response.send(stringify(mediaPlaylist));
    } else {
        // TODO handle no Subtitle Rendition Playlist found
    }
}

export const getVideoRenditionManifest = (request: MyRequest, response: Response, next: NextFunction) => {
    //console.log('requested: ' + request.path);
    let mediaPlaylist = videoRenditions.get(request.path);
    if (mediaPlaylist) {
        response.status(200).contentType("application/x-mpegURL");
        response.set('Content-Type', "application/x-mpegURL");
        response.send(stringify(mediaPlaylist));
    } else {
        // TODO handle no Subtitle Rendition Playlist found
    }
}
