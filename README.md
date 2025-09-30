# Building
`
npm install
npm run build
npm run start
`

# Running
`
curl --location 'http://localhost:3000/init' \
--header 'Content-Type: application/json' \
--header 'Cookie: connect.sid=s%3At-f8AT8XXRR1KnmnKmVlNMuqylLRFdVl.degoabAi2qW%2BbMELiq4BJrnQ95y204gVU5B8WVvSDNQ' \
--data '{
    "stream_url": "https://path/to/some/hls/stream.m3u8",
    "dvr_window_seconds": -1,
    "add_pdt_to_discontinuities": true,
    "startSegmentOffset": 1000
}'
`

`
export interface Vod2LiveRequest {
    /* * The URL of the VOD stream to be converted to live. */
    stream_url: string,
    /* * Length of DVR window. Value of -1 will = EVENT w/ growing DVR window instead of Sliding DVR Window */
    dvr_window_seconds?: number | 40,
    add_pdt_to_discontinuities?: boolean,
    live_edge_segments?: number | 3,
    ngrok_config?: { enabled: boolean, auth_token: string },
    start_offset?: StartOffset,
    pdt_start?: string, // ISO 8601 date string
    /* * Expirmental: If true, the stream will be replayed from the beginning when it reaches the end. */
    infinite_replay?: boolean,
    /* * The number of segments to start with. Can be used for starting with an existing DVR window */
    startSegmentOffset?: number, // Used to start with a pre-existing DVR window
}
`