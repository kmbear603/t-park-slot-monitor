var alert = require("alert-node");
var notifier = require('node-notifier');
var request = require("superagent");
var gmail = require("gmail-send");
var fs = require("fs");

const URL = "https://booking.tpark.hk/api/?cmd=getSlot";
const INTERVAL = 60 * 1000;
PERSON_COUNT = 0;
NOTIFY_EMAILS = [ ];
SENDER_EMAIL = "";
SENDER_PASSWORD = "";
DATE_OF_VISIT = []

const HISTORY = {
    carParks: [],
    spaPools: []
};

Date.prototype.yyyymmddhhmmss = function() {
    var mm = this.getMonth() + 1; // getMonth() is zero-based
    var dd = this.getDate();
    var hh = this.getHours();
    var m = this.getMinutes();
    var ss = this.getSeconds();
  
    return [
            this.getFullYear(),
            (mm > 9 ? '' : '0') + mm,
            (dd > 9 ? '' : '0') + dd
        ].join('-')
        + " "
        + [
            (hh > 9 ? "" : "0") + hh,
            (m > 9 ? "" : "0") + m,
            (ss > 9 ? "" : "0") + ss,
        ].join(":");
};

function readConfig(){
    var text = fs.readFileSync("config.json");
    var json = JSON.parse(text);

    PERSON_COUNT = json["numOfPersons"];
    NOTIFY_EMAILS = json["recipients"];
    SENDER_EMAIL = json["sender"]["gmail"];
    SENDER_PASSWORD = json["sender"]["password"];
    DATE_OF_VISIT = json["dateOfVisit"];
}

function getDate(dateText){
    var tokens = dateText.split("-");
    const year = parseInt(tokens[0]);
    const month = parseInt(tokens[1]);
    const day = parseInt(tokens[2]);
    var date = new Date(Date.now());
    date.setFullYear(year);
    date.setMonth(month - 1);
    date.setDate(day);
    date.setHours(0);
    date.setMinutes(0);
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date;
}

function getDateTime(datetimeText){
    var dateText = datetimeText.split(" ")[0];
    var timeText = datetimeText.split(" ")[1];

    var dateTokens = dateText.split("-");
    const year = parseInt(dateTokens[0]);
    const month = parseInt(dateTokens[1]);
    const day = parseInt(dateTokens[2]);

    var timeTokens = timeText.split(":");
    const hour = parseInt(timeTokens[0]);
    const minute = parseInt(timeTokens[1]);
    const second = parseInt(timeTokens[2]);

    var date = new Date(Date.now());
    date.setFullYear(year);
    date.setMonth(month - 1);
    date.setDate(day);
    date.setHours(hour);
    date.setMinutes(minute);
    date.setSeconds(second);
    date.setMilliseconds(0);
    return date;
}

function getCarParks(arr){
    return arr.map(o => {
        return {
            start: getDateTime(o["date_time_start"]),
            end: getDateTime(o["date_time_end"]),
            available: o["number_of_item"] - o["number_of_applicants"]
        };
    });
}

function getSpaPools(arr){
    return arr.map(o => {
        return {
            start: getDateTime(o["date_time_start"]),
            end: getDateTime(o["date_time_end"]),
            available: o["number_of_item"] - o["number_of_applicants"]
        };
    }).filter(spa => spa.available >= PERSON_COUNT);
}

function notifyUser(title, msg){
    //alert(title + ":\n\n" + msg);
    gmail({
        user: SENDER_EMAIL,
        pass: SENDER_PASSWORD,
        to: NOTIFY_EMAILS[0],
        subject: title,
        text: msg,
    }, (err, res) => {
        console.log(err, res);
    })();
}

function compareHistoryAndAlert(carParks, spaPools){
    var newlyAvailable = [];
    spaPools.forEach(spNew => {
        var spOld = HISTORY.spaPools.find(sp => sp.start.getTime() == spNew.start.getTime());
        if (spOld == null || spNew.available > spOld.available){
            newlyAvailable.push({ spa: spNew });
            console.log("spa: " + spNew.start.yyyymmddhhmmss() + " " + spNew.available + "  new");
        }
        else {
            console.log("spa: " + spNew.start.yyyymmddhhmmss() + " " + spNew.available);
        }
    });

    newlyAvailable.forEach(a => {
        // find matching car park
        const start = a.spa.start.getTime();
        const end = a.spa.end.getTime();
        var matchingCp = carParks.filter(cp => {
            return cp.start.getTime() >= start - 30 * 60 * 1000
                    && cp.end.getTime() <= end + 30 * 60 * 1000;
        });

        if (matchingCp.length == 0){
            a.coveredByCarParks = false;
        }
        else {
            // check if all available parkings are continuous
            var lastEnd = matchingCp[0].end.getTime();
            for (var i = 1; i < matchingCp.length; i++){
                if (matchingCp[i].start.getTime() != lastEnd){
                    a.coveredByCarParks = false;
                    break;
                }
                lastEnd = matchingCp[i].getTime();
            }

            a.coveredByCarParks = lastEnd >= end + 30 * 60 * 1000;
        }
    });

    if (newlyAvailable.length > 0){
        const message = newlyAvailable.map(a => {
            return a.spa.start.yyyymmddhhmmss() + " [vacancy=" + a.spa.available + "] [car park=" + (a.coveredByCarParks ? "sufficient" : "not enough") + "]";
        }).join("\n");
        /*notifier.notify({
            title: "T-Park monitor",
            message: new Date().yyyymmddhhmmss() + "\n\n" + message,
            wait: true
        });*/
        notifyUser("T-Park monitor " + new Date().yyyymmddhhmmss(), message);
    }
    else {
        console.log("nothing new");
    }
}

function isSameDate(date1, date2){
    return date1.getFullYear() == date2.getFullYear()
        && date1.getMonth() == date2.getMonth()
        && date1.getDate() == date2.getDate();
}

function isDesiredDateOfVisit(date){
    return DATE_OF_VISIT
        .map(d => getDate(d))
        .findIndex(d => isSameDate(d, date)) != -1;
}

function pullAndAlertTask(){
    return new Promise((resolve, reject) => {
        request
            .get(URL)
            .then(res => {
                var jsonText = res.text;
                var obj = JSON.parse(jsonText);
                
                var carParks = [];
                var spaPools = [];

                for (var dateText in obj["result"]){
                    // sat only
                    var date = getDate(dateText);
                    if (!isDesiredDateOfVisit(date)){
                        continue;
                    }

                    const infoObject = obj["result"][dateText];

                    carParks = carParks.concat(getCarParks(infoObject["car-park"])
                                        .filter(carPark => carPark.available > 0));

                    spaPools = spaPools.concat(getSpaPools(infoObject["spa-pools"])
                                            .filter(spaPool => spaPool.available > 0));
                }

                compareHistoryAndAlert(carParks, spaPools);

                HISTORY.carParks = carParks;
                HISTORY.spaPools = spaPools;

                resolve();
            })
            .catch (err => {
                reject(err);
            });
    });
}

function schedule(){
    console.log("next check in " + Math.round(INTERVAL / 1000) + " seconds");
    console.log("");

    setTimeout(async () => {
        console.log(new Date().yyyymmddhhmmss());

        try {
            await pullAndAlertTask();
            console.log("success");
        }
        catch (err){
            console.log(err);
        }

        schedule();
    }, INTERVAL);
}

async function run(){
    readConfig();
    await pullAndAlertTask();
    schedule();
}

run();
