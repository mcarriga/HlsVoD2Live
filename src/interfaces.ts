export interface StartOffset {
    offset: number,
    precise: boolean
}

export interface Vod2LiveRequest {
    /* * The URL of the VOD stream to be converted to live. */
    stream_url: string,
    /* * Length of DVR window. Value of -1 will = EVENT w/ growing DVR window instead of Sliding DVR Window */
    dvr_window_seconds?: number | 40,
    add_pdt_to_discontinuities?: boolean,
    live_edge_segments?: number | 3,
    ngrok_config?: { enabled: boolean, auth_token: string },
    start_offset?: StartOffset,
    pdt_start?: string,
    /* * Expirmental: If true, the stream will be replayed from the beginning when it reaches the end. */
    infinite_replay?: boolean,
    /* * The number of segments to start with. Can be used for starting with an existing DVR window */
    startSegmentOffset?: number,
}

export interface Vod2LiveResponse {
    status: string;
    local_stream: string,
    ngrok_stream?: string,
    errors?: string[]
}
