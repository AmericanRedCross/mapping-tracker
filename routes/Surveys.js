// var pg = require('pg');
var localConfig = require('../config');
var flow = require('flow');
var http = require('http');
var xpath = require('xpath');
var dom = require('xmldom').DOMParser;
var request = require('request');
var turf = require('turf');
var osmtogeojson = require('osmtogeojson');

var PostGresHelper = require("./PostGresHelper.js");
var pghelper = new PostGresHelper();

var Surveys = function() {
  this.surveyList = localConfig.omk.formList;
  this.surveys = {};
}

Surveys.prototype.downloadAllData = function(cb) {
  var self = this;
  var targetCount = 0;
  var counter = 0;
  targetSurveyCount = self.surveyList.length;
  for (var i=0;i<targetSurveyCount;i++) {
     (function(ind) {
         setTimeout(function(){
           // # # # throttle process to limit the speed of calls to downl .osm files from the server
           self.fetchData(self.surveyList[ind], function(err,data){
             counter ++;
             //console.log( key + " . . . " + counter + " ? ? ? " +  self.surveys[key].length)
             if(counter === targetSurveyCount){ cb(); }
           });

         }, 100 + (2000 * ind));
     })(i);
  }
}

Surveys.prototype.fetchData = function(survey, cb) {
  var self = this;
  request({
    method: 'GET',
    uri: localConfig.omk.server + "/omk/odk/submissions/" + survey + ".json",
    auth: { 'user': localConfig.omk.username, 'pass': localConfig.omk.password}
  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var jsonResponse = JSON.parse(body);
      self.surveys[survey] = jsonResponse;
      console.log("success w fetch for: " + survey)
      cb(null, survey);
    } else {
      console.log(" # # # # # # # ");
      console.log("fetch didnt work for: " + survey);
      console.log(localConfig.omk.server + "/omk/odk/submissions/" + survey + ".json")
      console.log("response code: " + response.statusCode);
      //console.log(response)
      cb('error', null);
      return;
    }
  });

}


Surveys.prototype.insertRows = function(key, cb) {
  var self = this;
  var targetCount = 0;
  var counter = 0;
  targetCount = self.surveys[key].length;
  for (var i=0;i<self.surveys[key].length;i++) {
     (function(ind) {
         setTimeout(function(){
           // # # # throttle process to limit the speed of calls to downl .osm files from the server
           self.insertRow(self.surveys[key][ind], function(err,data){
             counter ++;
            //  console.log( key + " . . . " + counter + " ? ? ? " +  self.surveys[key].length)
             if(counter === targetCount){ cb(null, key); }
           });

         }, 100 + (10 * ind));
     })(i);
  }
}

Surveys.prototype.insertRow = function(dataObj, cb) {
    var self = this;
    var insert = flow.define(
      function(){
        self.parseDataObject(dataObj, this);
      },
      function(ob){
        self.processOsm(ob, this.MULTI())
        self.processGeoPoint(ob, this.MULTI())
      },
      function(){
        cb();
      }
    );
    insert();
}

Surveys.prototype.parseDataObject = function(ob, cb) {

  var returnOb = {'osmFiles': [], 'latLng':[]}
  // # # # copy over attributes we need in later steps
  for (var i in ob.meta) {
    returnOb[i] = ob.meta[i];
  }

  function precision(a) {
    if (!isFinite(a)) return 0;
    var e = 1, p = 0;
    while (Math.round(a * e) / e !== a) { e *= 10; p++; }
    return p;
  }

  function findGeo(index, value){
    if ((typeof value) == 'object') {
      for (var x in value) findGeo(x, value[x]);
    } else {
      if ((typeof value) == 'string') {
        if(value.slice(-4).toLowerCase() === '.osm') returnOb.osmFiles.push(value);
      }
      // # # # the precision thing below is a hacky solution to get around
      // # # # https://github.com/AmericanRedCross/OpenMapKitServer/issues/59
      if (index === "latitude") {
        if (precision(parseFloat(value)) > 0) returnOb.latLng[0] = value;
      }
      if (index === "longitude") {
        if (precision(parseFloat(value)) > 0) returnOb.latLng[1] = value;
      }
      if (index === "today") returnOb['today'] = value;
    }
  }
  for (var i in ob) findGeo(i, ob[i]);
  if(!returnOb.today) returnOb['today'] = "1900/01/01";

  cb(returnOb);

}

Surveys.prototype.processOsm = function(ob, cb) {
  var self = this;
  for(file in ob.osmFiles){
    flow.exec(

      function(){
        self.fetchOsm(ob.osmFiles[file], ob, this);
      },
      function(err, geo){
        if(!err) {
          self.insertGeo(geo, ob, this);
        }
      }, function(){
        return;
      }
    );
  }
  cb();
}

Surveys.prototype.processGeoPoint = function(ob, cb) {
  var self = this;
  if(!isNaN(parseFloat(ob.latLng[0])) && !isNaN(parseFloat(ob.latLng[1]))){
    var geo = {
      "filename": "n/a",
      "category": "odk-geopoint",
      "point": turf.point([ob.latLng[1], ob.latLng[0]])
    }
    self.insertGeo(geo, ob, cb);
  } else {
    cb();
  }
}

Surveys.prototype.fetchOsm = function(filename, ob, cb){
  request({
    method: 'GET',
    uri: localConfig.omk.server + "/omk/data/submissions/" + ob.formId + "/" + ob.instanceId.slice(5) + "/" + filename,
    auth: { 'user': localConfig.omk.username, 'pass': localConfig.omk.password}
  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var xmlOsm = new dom().parseFromString(body);
      var geojsonOsm = osmtogeojson(xmlOsm);
      var category = "";
      switch(geojsonOsm.features[0].geometry.type) {
        case "Polygon":
          category = "omk-poly";
          break;
        case "Point":
          category = "omk-poi";
          break;
        default:
          console.log("ERROR: unknown omk feature type");
          category = "ERROR";
      }
      var geo = {
        "filename": filename,
        "category": category,
        "point": turf.centroid(geojsonOsm.features[0]),
        "tags": JSON.stringify(geojsonOsm.features[0].properties.tags)
      }
      cb(null, geo);
    } else {
      console.log("fetch didnt work for: " + filename);
      console.log(ob)
      cb("error");
    }
  });
}

Surveys.prototype.insertGeo = function(geo, ob, cb) {
  // console.log("geo : " + JSON.stringify(geo))
  // console.log("category : " + category)
  if(geo.tags !== undefined) { geo.tags = geo.tags.replace("'","''"); }
  var number;
  if(!geo.filename){ number = 0; } else {
    number = ob.osmFiles.indexOf(geo.filename) + 1;
  }
  var sql = "INSERT INTO data.submissions (id,uuid,formid,today,osmfile,type,tags,geom) VALUES (" +
    "'" + ob.instanceId.slice(5) + "-" + number + "'," +
    "'" + ob.instanceId.slice(5) + "'," +
    "'" + ob.formId + "'," +
    "'" + ob.today + "'," +
    "'" + geo.filename + "'," +
    "'" + geo.category + "'," +
    "'" + geo.tags + "'," +
    "ST_GeomFromGeoJSON('{" +
    '"type":"Point","coordinates":' +
    JSON.stringify(geo.point.geometry.coordinates) + "," +
    '"crs":{"type":"name","properties":{"name":"EPSG:4326"}}}' + "'));";

  pghelper.query(sql, cb);
}

module.exports = Surveys;
