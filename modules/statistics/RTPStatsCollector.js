/* global require, ssrc2jid */
/* jshint -W117 */

var logger = require("jitsi-meet-logger").getLogger(__filename);
var RTCBrowserType = require("../RTC/RTCBrowserType");

/* Whether we support the browser we are running into for logging statistics */
var browserSupported = RTCBrowserType.isChrome() ||
    RTCBrowserType.isOpera();

var keyMap = {};
keyMap[RTCBrowserType.RTC_BROWSER_FIREFOX] = {
    "ssrc": "ssrc",
    "packetsReceived": "packetsReceived",
    "packetsLost": "packetsLost",
    "packetsSent": "packetsSent",
    "bytesReceived": "bytesReceived",
    "bytesSent": "bytesSent"
};
keyMap[RTCBrowserType.RTC_BROWSER_CHROME] = {
    "receiveBandwidth": "googAvailableReceiveBandwidth",
    "sendBandwidth": "googAvailableSendBandwidth",
    "remoteAddress": "googRemoteAddress",
    "transportType": "googTransportType",
    "localAddress": "googLocalAddress",
    "activeConnection": "googActiveConnection",
    "ssrc": "ssrc",
    "packetsReceived": "packetsReceived",
    "packetsSent": "packetsSent",
    "packetsLost": "packetsLost",
    "bytesReceived": "bytesReceived",
    "bytesSent": "bytesSent",
    "googFrameHeightReceived": "googFrameHeightReceived",
    "googFrameWidthReceived": "googFrameWidthReceived",
    "googFrameHeightSent": "googFrameHeightSent",
    "googFrameWidthSent": "googFrameWidthSent",
    "audioInputLevel": "audioInputLevel",
    "audioOutputLevel": "audioOutputLevel"
};
keyMap[RTCBrowserType.RTC_BROWSER_OPERA] =
    keyMap[RTCBrowserType.RTC_BROWSER_CHROME];

/**
 * Calculates packet lost percent using the number of lost packets and the
 * number of all packet.
 * @param lostPackets the number of lost packets
 * @param totalPackets the number of all packets.
 * @returns {number} packet loss percent
 */
function calculatePacketLoss(lostPackets, totalPackets) {
    if(!totalPackets || totalPackets <= 0 || !lostPackets || lostPackets <= 0)
        return 0;
    return Math.round((lostPackets/totalPackets)*100);
}

function getStatValue(item, name) {
    var browserType = RTCBrowserType.getBrowserType();
    if (!keyMap[browserType][name])
        throw "The property isn't supported!";
    var key = keyMap[browserType][name];
    return (RTCBrowserType.isChrome() || RTCBrowserType.isOpera()) ?
        item.stat(key) : item[key];
}

function formatAudioLevel(audioLevel) {
    return Math.min(Math.max(audioLevel, 0), 1);
}

/**
 * Checks whether a certain record should be included in the logged statistics.
 */
function acceptStat(reportId, reportType, statName) {
    if (reportType == "googCandidatePair" && statName == "googChannelId")
        return false;

    if (reportType == "ssrc") {
        if (statName == "googTrackId" ||
            statName == "transportId" ||
            statName == "ssrc")
            return false;
    }

    return true;
}

/**
 * Checks whether a certain record should be included in the logged statistics.
 */
function acceptReport(id, type) {
    if (id.substring(0, 15) == "googCertificate" ||
        id.substring(0, 9) == "googTrack" ||
        id.substring(0, 20) == "googLibjingleSession")
        return false;

    if (type == "googComponent")
        return false;

    return true;
}

/**
 * Peer statistics data holder.
 * @constructor
 */
function PeerStats()
{
    this.ssrc2Loss = {};
    this.ssrc2AudioLevel = {};
    this.ssrc2bitrate = {};
    this.ssrc2resolution = {};
}

/**
 * Sets packets loss rate for given <tt>ssrc</tt> that blong to the peer
 * represented by this instance.
 * @param lossRate new packet loss rate value to be set.
 */
PeerStats.prototype.setSsrcLoss = function (lossRate)
{
    this.ssrc2Loss = lossRate;
};

/**
 * Sets resolution that belong to the ssrc
 * represented by this instance.
 * @param resolution new resolution value to be set.
 */
PeerStats.prototype.setSsrcResolution = function (resolution)
{
    if(resolution === null && this.ssrc2resolution[ssrc])
    {
        delete this.ssrc2resolution[ssrc];
    }
    else if(resolution !== null)
        this.ssrc2resolution[ssrc] = resolution;
};

/**
 * Sets the bit rate for given <tt>ssrc</tt> that blong to the peer
 * represented by this instance.
 * @param ssrc audio or video RTP stream SSRC.
 * @param bitrate new bitrate value to be set.
 */
PeerStats.prototype.setSsrcBitrate = function (ssrc, bitrate)
{
    if(this.ssrc2bitrate[ssrc])
    {
        this.ssrc2bitrate[ssrc].download += bitrate.download;
        this.ssrc2bitrate[ssrc].upload += bitrate.upload;
    }
    else {
        this.ssrc2bitrate[ssrc] = bitrate;
    }
};

/**
 * Sets new audio level(input or output) for given <tt>ssrc</tt> that identifies
 * the stream which belongs to the peer represented by this instance.
 * @param ssrc RTP stream SSRC for which current audio level value will be
 *        updated.
 * @param audioLevel the new audio level value to be set. Value is truncated to
 *        fit the range from 0 to 1.
 */
PeerStats.prototype.setSsrcAudioLevel = function (ssrc, audioLevel)
{
    // Range limit 0 - 1
    this.ssrc2AudioLevel[ssrc] = formatAudioLevel(audioLevel);
};

function ConferenceStats() {


    /**
     * The bandwidth
     * @type {{}}
     */
    this.bandwidth = {};

    /**
     * The bit rate
     * @type {{}}
     */
    this.bitrate = {};

    /**
     * The packet loss rate
     * @type {{}}
     */
    this.packetLoss = null;


    /**
     * Array with the transport information.
     * @type {Array}
     */
    this.transport = [];
}

/**
 * <tt>StatsCollector</tt> registers for stats updates of given
 * <tt>peerconnection</tt> in given <tt>interval</tt>. On each update particular
 * stats are extracted and put in {@link PeerStats} objects. Once the processing
 * is done <tt>audioLevelsUpdateCallback</tt> is called with <tt>this</tt>
 * instance as an event source.
 *
 * @param peerconnection webRTC peer connection object.
 * @param interval stats refresh interval given in ms.
 * @param {function(StatsCollector)} audioLevelsUpdateCallback the callback
 * called on stats update.
 * @param config {object} supports the following properties - disableAudioLevels, disableStats, logStats
 * @constructor
 */
function StatsCollector(peerconnection, audioLevelsInterval, statsInterval, eventEmitter, config)
{
    this.peerconnection = peerconnection;
    this.baselineAudioLevelsReport = null;
    this.currentAudioLevelsReport = null;
    this.currentStatsReport = null;
    this.baselineStatsReport = null;
    this.audioLevelsIntervalId = null;
    this.eventEmitter = eventEmitter;
    this.config = config || {};
    this.conferenceStats = new ConferenceStats();

    /**
     * Gather PeerConnection stats once every this many milliseconds.
     */
    this.GATHER_INTERVAL = 15000;

    /**
     * Log stats via the focus once every this many milliseconds.
     */
    this.LOG_INTERVAL = 60000;

    /**
     * Gather stats and store them in this.statsToBeLogged.
     */
    this.gatherStatsIntervalId = null;

    /**
     * Send the stats already saved in this.statsToBeLogged to be logged via
     * the focus.
     */
    this.logStatsIntervalId = null;

    /**
     * Stores the statistics which will be send to the focus to be logged.
     */
    this.statsToBeLogged =
    {
        timestamps: [],
        stats: {}
    };

    // Updates stats interval
    this.audioLevelsIntervalMilis = audioLevelsInterval;

    this.statsIntervalId = null;
    this.statsIntervalMilis = statsInterval;
    // Map of ssrcs to PeerStats
    this.ssrc2stats = {};
}

module.exports = StatsCollector;

/**
 * Stops stats updates.
 */
StatsCollector.prototype.stop = function () {
    if (this.audioLevelsIntervalId) {
        clearInterval(this.audioLevelsIntervalId);
        this.audioLevelsIntervalId = null;
    }

    if (this.statsIntervalId)
    {
        clearInterval(this.statsIntervalId);
        this.statsIntervalId = null;
    }

    if(this.logStatsIntervalId)
    {
        clearInterval(this.logStatsIntervalId);
        this.logStatsIntervalId = null;
    }

    if(this.gatherStatsIntervalId)
    {
        clearInterval(this.gatherStatsIntervalId);
        this.gatherStatsIntervalId = null;
    }
};

/**
 * Callback passed to <tt>getStats</tt> method.
 * @param error an error that occurred on <tt>getStats</tt> call.
 */
StatsCollector.prototype.errorCallback = function (error)
{
    logger.error("Get stats error", error);
    this.stop();
};

/**
 * Starts stats updates.
 */
StatsCollector.prototype.start = function ()
{
    var self = this;
    this.audioLevelsIntervalId = setInterval(
        function () {
            // Interval updates
            self.peerconnection.getStats(
                function (report) {
                    var results = null;
                    if (!report || !report.result ||
                        typeof report.result != 'function') {
                        results = report;
                    }
                    else {
                        results = report.result();
                    }
                    //logger.error("Got interval report", results);
                    self.currentAudioLevelsReport = results;
                    self.processAudioLevelReport();
                    self.baselineAudioLevelsReport =
                        self.currentAudioLevelsReport;
                },
                self.errorCallback
            );
        },
        self.audioLevelsIntervalMilis
    );

//    if (!this.config.disableStats && browserSupported) {
//        this.statsIntervalId = setInterval(
//            function () {
//                // Interval updates
//                self.peerconnection.getStats(
//                    function (report) {
//                        var results = null;
//                        if (!report || !report.result ||
//                            typeof report.result != 'function') {
//                            //firefox
//                            results = report;
//                        }
//                        else {
//                            //chrome
//                            results = report.result();
//                        }
//                        //logger.error("Got interval report", results);
//                        self.currentStatsReport = results;
//                        try {
//                            self.processStatsReport();
//                        }
//                        catch (e) {
//                            logger.error("Unsupported key:" + e, e);
//                        }
//
//                        self.baselineStatsReport = self.currentStatsReport;
//                    },
//                    self.errorCallback
//                );
//            },
//            self.statsIntervalMilis
//        );
//    }
//
//    if (this.config.logStats && browserSupported) {
//        this.gatherStatsIntervalId = setInterval(
//            function () {
//                self.peerconnection.getStats(
//                    function (report) {
//                        self.addStatsToBeLogged(report.result());
//                    },
//                    function () {
//                    }
//                );
//            },
//            this.GATHER_INTERVAL
//        );
//
//        this.logStatsIntervalId = setInterval(
//            function() { self.logStats(); },
//            this.LOG_INTERVAL);
//    }
};

/**
 * Converts the stats to the format used for logging, and saves the data in
 * this.statsToBeLogged.
 * @param reports Reports as given by webkitRTCPerConnection.getStats.
 */
StatsCollector.prototype.addStatsToBeLogged = function (reports) {
    var self = this;
    var num_records = this.statsToBeLogged.timestamps.length;
    this.statsToBeLogged.timestamps.push(new Date().getTime());
    reports.map(function (report) {
        if (!acceptReport(report.id, report.type))
            return;
        var stat = self.statsToBeLogged.stats[report.id];
        if (!stat) {
            stat = self.statsToBeLogged.stats[report.id] = {};
        }
        stat.type = report.type;
        report.names().map(function (name) {
            if (!acceptStat(report.id, report.type, name))
                return;
            var values = stat[name];
            if (!values) {
                values = stat[name] = [];
            }
            while (values.length < num_records) {
                values.push(null);
            }
            values.push(report.stat(name));
        });
    });
};


//FIXME:
//StatsCollector.prototype.logStats = function () {
//
//    if(!APP.xmpp.sendLogs(this.statsToBeLogged))
//        return;
//    // Reset the stats
//    this.statsToBeLogged.stats = {};
//    this.statsToBeLogged.timestamps = [];
//};


/**
 * Stats processing logic.
 */
StatsCollector.prototype.processStatsReport = function () {
    if (!this.baselineStatsReport) {
        return;
    }

    for (var idx in this.currentStatsReport) {
        var now = this.currentStatsReport[idx];
        try {
            if (getStatValue(now, 'receiveBandwidth') ||
                getStatValue(now, 'sendBandwidth')) {
                this.conferenceStats.bandwidth = {
                    "download": Math.round(
                            (getStatValue(now, 'receiveBandwidth')) / 1000),
                    "upload": Math.round(
                            (getStatValue(now, 'sendBandwidth')) / 1000)
                };
            }
        }
        catch(e){/*not supported*/}

        if(now.type == 'googCandidatePair')
        {
            var ip, type, localIP, active;
            try {
                ip = getStatValue(now, 'remoteAddress');
                type = getStatValue(now, "transportType");
                localIP = getStatValue(now, "localAddress");
                active = getStatValue(now, "activeConnection");
            }
            catch(e){/*not supported*/}
            if(!ip || !type || !localIP || active != "true")
                continue;
            var addressSaved = false;
            for(var i = 0; i < this.conferenceStats.transport.length; i++)
            {
                if(this.conferenceStats.transport[i].ip == ip &&
                    this.conferenceStats.transport[i].type == type &&
                    this.conferenceStats.transport[i].localip == localIP)
                {
                    addressSaved = true;
                }
            }
            if(addressSaved)
                continue;
            this.conferenceStats.transport.push({localip: localIP, ip: ip, type: type});
            continue;
        }

        if(now.type == "candidatepair")
        {
            if(now.state == "succeeded")
                continue;

            var local = this.currentStatsReport[now.localCandidateId];
            var remote = this.currentStatsReport[now.remoteCandidateId];
            this.conferenceStats.transport.push({localip: local.ipAddress + ":" + local.portNumber,
                ip: remote.ipAddress + ":" + remote.portNumber, type: local.transport});

        }

        if (now.type != 'ssrc' && now.type != "outboundrtp" &&
            now.type != "inboundrtp") {
            continue;
        }

        var before = this.baselineStatsReport[idx];
        if (!before) {
            logger.warn(getStatValue(now, 'ssrc') + ' not enough data');
            continue;
        }

        var ssrc = getStatValue(now, 'ssrc');
        if(!ssrc)
            continue;

        var ssrcStats = this.ssrc2stats[ssrc];
        if (!ssrcStats) {
            ssrcStats = new PeerStats();
            this.ssrc2stats[ssrc] = ssrcStats;
        }


        var isDownloadStream = true;
        var key = 'packetsReceived';
        if (!getStatValue(now, key))
        {
            isDownloadStream = false;
            key = 'packetsSent';
            if (!getStatValue(now, key))
            {
                logger.warn("No packetsReceived nor packetSent stat found");
                continue;
            }
        }
        var packetsNow = getStatValue(now, key);
        if(!packetsNow || packetsNow < 0)
            packetsNow = 0;

        var packetsBefore = getStatValue(before, key);
        if(!packetsBefore || packetsBefore < 0)
            packetsBefore = 0;
        var packetRate = packetsNow - packetsBefore;
        if(!packetRate || packetRate < 0)
            packetRate = 0;
        var currentLoss = getStatValue(now, 'packetsLost');
        if(!currentLoss || currentLoss < 0)
            currentLoss = 0;
        var previousLoss = getStatValue(before, 'packetsLost');
        if(!previousLoss || previousLoss < 0)
            previousLoss = 0;
        var lossRate = currentLoss - previousLoss;
        if(!lossRate || lossRate < 0)
            lossRate = 0;
        var packetsTotal = (packetRate + lossRate);

        ssrcStats.setSsrcLoss(ssrc,
            {"packetsTotal": packetsTotal,
                "packetsLost": lossRate,
                "isDownloadStream": isDownloadStream});


        var bytesReceived = 0, bytesSent = 0;
        if(getStatValue(now, "bytesReceived"))
        {
            bytesReceived = getStatValue(now, "bytesReceived") -
                getStatValue(before, "bytesReceived");
        }

        if(getStatValue(now, "bytesSent"))
        {
            bytesSent = getStatValue(now, "bytesSent") -
                getStatValue(before, "bytesSent");
        }

        var time = Math.round((now.timestamp - before.timestamp) / 1000);
        if(bytesReceived <= 0 || time <= 0)
        {
            bytesReceived = 0;
        }
        else
        {
            bytesReceived = Math.round(((bytesReceived * 8) / time) / 1000);
        }

        if(bytesSent <= 0 || time <= 0)
        {
            bytesSent = 0;
        }
        else
        {
            bytesSent = Math.round(((bytesSent * 8) / time) / 1000);
        }

        ssrcStats.setSsrcBitrate(ssrc, {
            "download": bytesReceived,
            "upload": bytesSent});

        var resolution = {height: null, width: null};
        try {
            if (getStatValue(now, "googFrameHeightReceived") &&
                getStatValue(now, "googFrameWidthReceived")) {
                resolution.height = getStatValue(now, "googFrameHeightReceived");
                resolution.width = getStatValue(now, "googFrameWidthReceived");
            }
            else if (getStatValue(now, "googFrameHeightSent") &&
                getStatValue(now, "googFrameWidthSent")) {
                resolution.height = getStatValue(now, "googFrameHeightSent");
                resolution.width = getStatValue(now, "googFrameWidthSent");
            }
        }
        catch(e){/*not supported*/}

        if(resolution.height && resolution.width)
        {
            ssrcStats.setSsrcResolution(ssrc, resolution);
        }
        else
        {
            ssrcStats.setSsrcResolution(ssrc, null);
        }


    }

    var self = this;
    // Jid stats
    var totalPackets = {download: 0, upload: 0};
    var lostPackets = {download: 0, upload: 0};
    var bitrateDownload = 0;
    var bitrateUpload = 0;
    var resolutions = {};
    Object.keys(this.ssrc2stats).forEach(
        function (jid)
        {
            Object.keys(self.ssrc2stats[jid].ssrc2Loss).forEach(
                function (ssrc)
                {
                    var type = "upload";
                    if(self.ssrc2stats[jid].ssrc2Loss[ssrc].isDownloadStream)
                        type = "download";
                    totalPackets[type] +=
                        self.ssrc2stats[jid].ssrc2Loss[ssrc].packetsTotal;
                    lostPackets[type] +=
                        self.ssrc2stats[jid].ssrc2Loss[ssrc].packetsLost;
                }
            );
            Object.keys(self.ssrc2stats[jid].ssrc2bitrate).forEach(
                function (ssrc) {
                    bitrateDownload +=
                        self.ssrc2stats[jid].ssrc2bitrate[ssrc].download;
                    bitrateUpload +=
                        self.ssrc2stats[jid].ssrc2bitrate[ssrc].upload;

                    delete self.ssrc2stats[jid].ssrc2bitrate[ssrc];
                }
            );
            resolutions[jid] = self.ssrc2stats[jid].ssrc2resolution;
        }
    );

    this.conferenceStats.bitrate = {"upload": bitrateUpload, "download": bitrateDownload};

    this.conferenceStats.packetLoss = {
        total:
            calculatePacketLoss(lostPackets.download + lostPackets.upload,
                    totalPackets.download + totalPackets.upload),
        download:
            calculatePacketLoss(lostPackets.download, totalPackets.download),
        upload:
            calculatePacketLoss(lostPackets.upload, totalPackets.upload)
    };
    this.eventEmitter.emit("statistics.connectionstats",
        {
            "bitrate": this.conferenceStats.bitrate,
            "packetLoss": this.conferenceStats.packetLoss,
            "bandwidth": this.conferenceStats.bandwidth,
            "resolution": resolutions,
            "transport": this.conferenceStats.transport
        });
    this.conferenceStats.transport = [];

};

/**
 * Stats processing logic.
 */
StatsCollector.prototype.processAudioLevelReport = function () {
    if (!this.baselineAudioLevelsReport) {
        return;
    }

    for (var idx in this.currentAudioLevelsReport) {
        var now = this.currentAudioLevelsReport[idx];

        //if we don't have "packetsReceived" this is local stream
        if (now.type != 'ssrc' || !getStatValue(now, 'packetsReceived')) {
            continue;
        }

        var before = this.baselineAudioLevelsReport[idx];
        if (!before) {
            logger.warn(getStatValue(now, 'ssrc') + ' not enough data');
            continue;
        }

        var ssrc = getStatValue(now, 'ssrc');
        if (!ssrc) {
            if((Date.now() - now.timestamp) < 3000)
                logger.warn("No ssrc: ");
            continue;
        }

        var ssrcStats = this.ssrc2stats[ssrc];
        if (!ssrcStats) {
            ssrcStats = new PeerStats();
            this.ssrc2stats[ssrc] = ssrcStats;
        }

        // Audio level
        var audioLevel = null;

        try {
            audioLevel = getStatValue(now, 'audioInputLevel');
            if (!audioLevel)
                audioLevel = getStatValue(now, 'audioOutputLevel');
        }
        catch(e) {/*not supported*/
            logger.warn("Audio Levels are not available in the statistics.");
            clearInterval(this.audioLevelsIntervalId);
            return;
        }

        if (audioLevel) {
            // TODO: can't find specs about what this value really is,
            // but it seems to vary between 0 and around 32k.
            audioLevel = audioLevel / 32767;
            ssrcStats.setSsrcAudioLevel(ssrc, audioLevel);
            this.eventEmitter.emit("statistics.audioLevel", ssrc, audioLevel);
        }
    }
};
