// ======================================
// 1. HTML ELEMENTS
// ======================================

const startButton = document.getElementById("startButton");
const pauseButton = document.getElementById("pauseButton");
const resumeButton = document.getElementById("resumeButton");
const stopButton = document.getElementById("stopButton");

const durationElement = document.getElementById("duration");
const distanceElement = document.getElementById("distance");
const lapsElement = document.getElementById("laps");

const averageSpeedElement = document.getElementById("averageSpeed");
const currentSpeedElement = document.getElementById("currentSpeed");
const maxSpeedElement = document.getElementById("maxSpeed");

const locationStatus = document.getElementById("locationStatus");
const footerText = document.getElementById("footerText");
const aiCoachButton = document.getElementById("aiCoachButton");


// ======================================
// 2. RUNNING STATE
// ======================================

let runState = "idle";
// idle = not started
// running = active run
// paused = temporarily paused

let watchId = null;

let startTime = 0;
let pausedDuration = 0;
let pauseStartedAt = 0;

let totalDistanceKm = 0;
let maxSpeedKmh = 0;
let currentSpeedKmh = 0;

let lastPosition = null;
let routeCoordinates = [];

let map = null;
let routeLine = null;
let currentMarker = null;

let runStartPosition = null;
let lastLapDistanceKm = 0;
let lapLengthKm = 0.4; // Example: 400-metre lap

let lastAcceptedPosition = null;
let lastAcceptedTime = 0;

let savedSession = null;


// ======================================
// 3. MAP INITIALIZATION
// ======================================

// Google Maps script calls this function.
window.initMap = function () {

    const defaultLocation = {
        lat: 13.0827,
        lng: 80.2707
    };

    map = new google.maps.Map(
        document.getElementById("map"),
        {
            center: defaultLocation,
            zoom: 16,

            mapTypeId: "roadmap",

            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true
        }
    );

    routeLine = new google.maps.Polyline({
        path: [],
        geodesic: true,
        strokeColor: "#00C8FF",
        strokeOpacity: 1,
        strokeWeight: 6,
        map: map
    });

    locationStatus.textContent =
        "Map ready. Press START to begin.";

};


// ======================================
// 4. DISTANCE CALCULATION
// ======================================

function calculateDistanceKm(position1, position2) {

    const earthRadiusKm = 6371;

    const lat1 =
        position1.latitude * Math.PI / 180;

    const lat2 =
        position2.latitude * Math.PI / 180;

    const differenceLat =
        (position2.latitude - position1.latitude)
        * Math.PI / 180;

    const differenceLng =
        (position2.longitude - position1.longitude)
        * Math.PI / 180;

    const a =
        Math.sin(differenceLat / 2) ** 2 +
        Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(differenceLng / 2) ** 2;

    const c =
        2 * Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return earthRadiusKm * c;
}


// ======================================
// 5. DURATION CALCULATION
// ======================================

function getElapsedSeconds() {

    if (!startTime) {
        return 0;
    }

    let endTime;

    if (runState === "paused") {
        endTime = pauseStartedAt;
    } else {
        endTime = Date.now();
    }

    const elapsed =
        endTime - startTime - pausedDuration;

    return Math.max(0, Math.floor(elapsed / 1000));
}


function formatDuration(totalSeconds) {

    const hours = Math.floor(totalSeconds / 3600);

    const minutes =
        Math.floor((totalSeconds % 3600) / 60);

    const seconds = totalSeconds % 60;

    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");

    if (hours > 0) {
        return (
            String(hours).padStart(2, "0") +
            ":" + mm + ":" + ss
        );
    }

    return mm + ":" + ss;
}


function updateStatistics() {

    const elapsedSeconds = getElapsedSeconds();

    durationElement.textContent =
        formatDuration(elapsedSeconds);

    distanceElement.textContent =
        totalDistanceKm.toFixed(2);

    averageSpeedElement.textContent =
        elapsedSeconds > 0
            ? (
                totalDistanceKm /
                (elapsedSeconds / 3600)
            ).toFixed(1)
            : "0.0";

    currentSpeedElement.textContent =
        currentSpeedKmh.toFixed(1);

    maxSpeedElement.textContent =
        maxSpeedKmh.toFixed(1);

    lapsElement.textContent =
        Math.floor(totalDistanceKm / lapLengthKm);
}


// ======================================
// 6. GPS TRACKING
// ======================================

function startGPSTracking() {

    if (!navigator.geolocation) {

        locationStatus.textContent =
            "This browser does not support GPS tracking.";

        return false;
    }

    watchId = navigator.geolocation.watchPosition(

        handlePosition,

        function (error) {

            const messages = {
                1: "Location permission denied. Allow location access.",
                2: "Current location is unavailable.",
                3: "GPS request timed out. Please try again."
            };

            locationStatus.textContent =
                messages[error.code] ||
                "Unable to access your location.";
        },

        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 15000
        }
    );

    return true;
}


function stopGPSTracking() {

    if (watchId !== null) {

        navigator.geolocation.clearWatch(watchId);

        watchId = null;
    }

}


// ======================================
// 7. PROCESS NEW GPS POSITION
// ======================================

function handlePosition(position) {

    // Ignore GPS updates when not actively running.
    if (runState !== "running") {
        return;
    }

    const coords = position.coords;

    const currentPosition = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy
    };

    const currentTime = position.timestamp || Date.now();

    // Ignore inaccurate GPS readings.
    if (coords.accuracy > 35) {

        locationStatus.textContent =
            "GPS accuracy is low. Waiting for a better signal.";

        return;
    }

    // Save the first position.
    if (!lastPosition) {

        lastPosition = currentPosition;

        runStartPosition = currentPosition;

        lastAcceptedPosition = currentPosition;
        lastAcceptedTime = currentTime;

        addPositionToMap(currentPosition);

        locationStatus.textContent =
            "GPS connected. Run tracking is active.";

        return;
    }

    const distanceBetweenPoints = calculateDistanceKm(
        lastPosition,
        currentPosition
    );

    const timeDifferenceHours =
        (currentTime - lastAcceptedTime) / 3600000;

    if (timeDifferenceHours <= 0) {
        return;
    }

    const measuredSpeedKmh =
        distanceBetweenPoints / timeDifferenceHours;

    /*
      Basic GPS noise filter:
      - Skip impossible jumps.
      - Skip large jumps caused by poor GPS readings.

      GPS can still be inaccurate; this is not a professional
      sports-grade measurement system.
    */

    if (distanceBetweenPoints > 0.15) {

        locationStatus.textContent =
            "GPS jump detected. Waiting for a stable position.";

        return;
    }

    // Ignore tiny movements caused by GPS drift.
    if (distanceBetweenPoints < 0.003) {

        updateMarkerOnly(currentPosition);

        return;
    }

    // Ignore implausible running speeds.
    if (measuredSpeedKmh > 35) {

        locationStatus.textContent =
            "GPS speed reading looks inaccurate. Ignoring it.";

        return;
    }

    totalDistanceKm += distanceBetweenPoints;

    currentSpeedKmh = measuredSpeedKmh;

    maxSpeedKmh = Math.max(
        maxSpeedKmh,
        currentSpeedKmh
    );

    lastPosition = currentPosition;

    lastAcceptedPosition = currentPosition;
    lastAcceptedTime = currentTime;

    addPositionToMap(currentPosition);

    updateStatistics();

}


// ======================================
// 8. MAP MARKER AND ROUTE LINE
// ======================================

function addPositionToMap(position) {

    if (!map || !routeLine) {
        return;
    }

    const mapPosition = {
        lat: position.latitude,
        lng: position.longitude
    };

    routeCoordinates.push(mapPosition);

    routeLine.setPath(routeCoordinates);

    if (!currentMarker) {

        currentMarker = new google.maps.Marker({
            position: mapPosition,
            map: map,
            title: "Your current location"
        });

    } else {

        currentMarker.setPosition(mapPosition);
    }

    map.panTo(mapPosition);

}


function updateMarkerOnly(position) {

    if (!map) {
        return;
    }

    const mapPosition = {
        lat: position.latitude,
        lng: position.longitude
    };

    if (currentMarker) {

        currentMarker.setPosition(mapPosition);
    }

}


// ======================================
// 9. START BUTTON
// ======================================

startButton.addEventListener("click", function () {

    if (runState !== "idle") {
        return;
    }

    if (!navigator.geolocation) {

        locationStatus.textContent =
            "Your browser does not support GPS.";

        return;
    }

    // Reset session values.
    totalDistanceKm = 0;
    maxSpeedKmh = 0;
    currentSpeedKmh = 0;

    startTime = Date.now();

    pausedDuration = 0;
    pauseStartedAt = 0;

    lastPosition = null;
    lastAcceptedPosition = null;
    lastAcceptedTime = 0;

    runStartPosition = null;
    lastLapDistanceKm = 0;

    routeCoordinates = [];

    savedSession = null;

    if (routeLine) {
        routeLine.setPath([]);
    }

    if (currentMarker) {
        currentMarker.setMap(null);
        currentMarker = null;
    }

    updateStatistics();

    runState = "running";

    startButton.hidden = true;

    pauseButton.hidden = false;
    stopButton.hidden = false;
    resumeButton.hidden = true;

    footerText.textContent =
        "Your run is in progress.";

    locationStatus.textContent =
        "Requesting GPS location permission...";

    startGPSTracking();

});


// ======================================
// 10. PAUSE BUTTON
// ======================================

pauseButton.addEventListener("click", function () {

    if (runState !== "running") {
        return;
    }

    runState = "paused";

    pauseStartedAt = Date.now();

    stopGPSTracking();

    currentSpeedKmh = 0;

    pauseButton.hidden = true;
    resumeButton.hidden = false;

    locationStatus.textContent =
        "Run paused.";

    footerText.textContent =
        "Your run is paused. Press RESUME to continue.";

    updateStatistics();

});


// ======================================
// 11. RESUME BUTTON
// ======================================

resumeButton.addEventListener("click", function () {

    if (runState !== "paused") {
        return;
    }

    pausedDuration +=
        Date.now() - pauseStartedAt;

    pauseStartedAt = 0;

    // Re-establish GPS without counting paused movement.
    lastPosition = null;
    lastAcceptedPosition = null;
    lastAcceptedTime = 0;

    runState = "running";

    resumeButton.hidden = true;
    pauseButton.hidden = false;

    locationStatus.textContent =
        "Resuming GPS tracking...";

    footerText.textContent =
        "Your run is in progress.";

    startGPSTracking();

});


// ======================================
// 12. STOP BUTTON
// ======================================

stopButton.addEventListener("click", async function () {

    if (runState === "idle") {
        return;
    }

    if (runState === "paused") {

        pausedDuration +=
            Date.now() - pauseStartedAt;

        pauseStartedAt = 0;
    }

    const finalDurationSeconds = getElapsedSeconds();

    // Stop GPS and timer calculations.
    stopGPSTracking();

    runState = "idle";

    currentSpeedKmh = 0;

    startButton.hidden = false;

    pauseButton.hidden = true;
    resumeButton.hidden = true;
    stopButton.hidden = true;

    updateStatistics();

    const sessionData = {

        durationSeconds: finalDurationSeconds,

        distanceKm: Number(totalDistanceKm.toFixed(3)),

        laps: Math.floor(totalDistanceKm / lapLengthKm),

        averageSpeedKmh:
            finalDurationSeconds > 0
                ? Number(
                    (
                        totalDistanceKm /
                        (finalDurationSeconds / 3600)
                    ).toFixed(2)
                )
                : 0,

        maxSpeedKmh:
            Number(maxSpeedKmh.toFixed(2)),

        route: routeCoordinates,

        startedAt:
            new Date(startTime).toISOString(),

        endedAt:
            new Date().toISOString()
    };

    footerText.textContent =
        "Run completed. Press START for a new session.";

    locationStatus.textContent =
        "Saving your running session...";

    await saveRunningSession(sessionData);

});


// ======================================
// 13. SAVE SESSION TO BACKEND
// ======================================

async function saveRunningSession(sessionData) {

    try {

        const response = await fetch(
            "http://localhost:5000/api/running",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify(sessionData)
            }
        );

        const result = await response.json();

        if (!response.ok) {

            throw new Error(
                result.message || "Unable to save run."
            );
        }

        savedSession = result;

        locationStatus.textContent =
            "Run completed and saved successfully.";

    } catch (error) {

        console.error("Save error:", error);

        locationStatus.textContent =
            "Run stopped, but saving failed. Check backend connection.";

    }

}


// ======================================
// 14. AI TRACK COACH BUTTON
// ======================================

aiCoachButton.addEventListener("click", function () {

    if (runState !== "idle") {

        alert(
            "Stop your run first to review the completed session."
        );

        return;
    }

    alert(
        "Your running summary: " +
        totalDistanceKm.toFixed(2) +
        " km completed. " +
        "Average speed: " +
        averageSpeedElement.textContent +
        " km/h. " +
        "Max speed: " +
        maxSpeedElement.textContent +
        " km/h."
    );

});


// ======================================
// 15. UPDATE DURATION EVERY SECOND
// ======================================

setInterval(function () {

    if (runState === "running" || runState === "paused") {

        updateStatistics();
    }

}, 1000);