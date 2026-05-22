# Building & Running
    npm install
    npm run build
    npm run start


# Initializing

    curl --location 'http://localhost:3000/init' \
    --header 'Content-Type: application/json' \
    --data '{
        "stream_url": "https://path/to/some/hls/stream.m3u8",
        "dvr_window_seconds": -1,
        "add_pdt_to_discontinuities": true,
        "startSegmentOffset": 1000
    }'



# Vod2LiveRequest 
    stream_url: string,
    dvr_window_seconds?: number | 40, // -1 = EVENT w/ growing DVR window instead of sliding DVR Window
    add_pdt_to_discontinuities?: boolean,
    live_edge_segments?: number | 3,
    ngrok_config?: { enabled: boolean, auth_token: string },
    start_offset?: StartOffset,
    pdt_start?: string, // ISO 8601 date string
    startSegmentOffset?: number, // Used to start with a pre-existing DVR window