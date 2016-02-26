var turf = require('turf');
var fs = require('fs');
var tj = require('togeojson');
var jsdom = require('jsdom').jsdom;
var path = require('path');
var pg = require('pg');
var localConfig = require('../config');
var flow = require('flow');

var AWS = require('aws-sdk');
var s3 = new AWS.S3();

var PostGresHelper = require("./PostGresHelper.js");
var pghelper = new PostGresHelper();

var Gpx = function() {
  this.featureCollections = {};
}

Gpx.prototype.fetchFilelist = function(cb) {

  console.log('fetchFileList')
  var listParams = {
    Bucket: localConfig.s3.bucket,
    Prefix: localConfig.s3.gpxFolder
  };

  var self = this;

  s3.listObjects(listParams, function(err, data) {

    if(err){
      cb(err, null)
      return;
    }

    for(var i=0; i < data.Contents.length; i++){
      var fileKey = data.Contents[i].Key
      if(path.extname(fileKey) === '.gpx'){ self.featureCollections[fileKey] = ""; }
      if(i+1 === data.Contents.length){
        console.log("yep")
        cb(null, self.featureCollections);

      }
    }

  });

}

Gpx.prototype.fetchAllData = function(cb) {
  console.log('fetch all Data')

  var self = this;

  var getData = flow.define(
    function(){
        for(var key in self.featureCollections) {
          self.fetchConvertData(key, this.MULTI());
        }
    },
    function(){
      console.log('done fetchConvertData')
      //When all are complete, fire callback
      cb();
    }
  )
  //Trigger the flow
  getData();

}

Gpx.prototype.fetchConvertData = function(fileKey, cb) {

  var self = this;

  var getParams = {
    Bucket: localConfig.s3.bucket,
    Key: fileKey
  };

  console.log("fetchConvert: " + fileKey);

  s3.getObject(getParams, function(err, data) {
    var gpx = jsdom(data.Body);
    var converted = tj.gpx(gpx);

    self.featureCollections[fileKey] = converted;
    cb();
  });

}

Gpx.prototype.segmentTracks = function(cb) {

  var self = this;

  var emptyLinestring = function(){
    return turf.linestring([],
    {
      "date": '',
      "km": 0,
      "hours": 0,
      "start": '',
      "end": '',
      "speed": ''
    })
  }

  var insertRows = flow.define(
    function () {

      for(var key in self.featureCollections) {

            var sql = "";

            var data = self.featureCollections[key];

            if(data.features){

              var addingTo = 0;
              var holdingArray = [ emptyLinestring(), emptyLinestring() ];

              var lastTimeStamp;

              var removeZ = function(latlng){
                if(latlng.length = 3){ latlng.pop(); }
                return latlng;
              }

              if(data.features[0].geometry.type === "LineString") {
                holdingArray[0].geometry.coordinates.push(removeZ(data.features[0].geometry.coordinates[0]));
                lastTimeStamp = new Date(data.features[0].properties.coordTimes[0]);
                holdingArray[0].properties.date = lastTimeStamp;
              } else if (data.features[0].geometry.type === "MultiLineString") {
                holdingArray[0].geometry.coordinates.push(removeZ(data.features[0].geometry.coordinates[0][0]));
                lastTimeStamp = new Date(data.features[0].properties.coordTimes[0][0]);
                holdingArray[0].properties.date = lastTimeStamp;
              } else {
                console.log("no LineString or MultiLineString")
              }

              // ### pretend testoutput is the PostGIS database
              processNextPoint = function(coordinates, datetime){
                var segmentStart = holdingArray[addingTo].geometry.coordinates[holdingArray[addingTo].geometry.coordinates.length - 1];
                var segmentDistance = turf.distance(turf.point(segmentStart), turf.point(coordinates), 'kilometers');
                var timeEnd = new Date(datetime);
                var hours = (Math.abs(timeEnd - lastTimeStamp) === 0) ? 0 : Math.abs(timeEnd - lastTimeStamp) / 3.6e6;
                var speed = (segmentDistance > 0 && hours > 0) ? segmentDistance / hours : 0;
                var speedCategory = (speed > 6.5) ? 'moto' : 'walk';
                // ## Add to the first line segment until the speed changes
                if(addingTo === 0){
                  if(holdingArray[addingTo].geometry.coordinates.length === 1){
                    holdingArray[addingTo].properties.speed = speedCategory;
                  }
                  if(holdingArray[addingTo].properties.speed === speedCategory){
                    //console.log('adding to zero')
                    holdingArray[addingTo].geometry.coordinates.push(coordinates);
                    holdingArray[addingTo].properties.km += segmentDistance;
                    holdingArray[addingTo].properties.hours += hours;
                    lastTimeStamp = timeEnd;
                  } else {
                    // ## been adding to 0, speed switches, start adding to 1
                    //console.log("switch to 1");
                    addingTo = 1
                    holdingArray[addingTo].geometry.coordinates.push(segmentStart);
                    holdingArray[addingTo].geometry.coordinates.push(coordinates);
                    holdingArray[addingTo].properties.start = lastTimeStamp;
                    holdingArray[addingTo].properties.date = lastTimeStamp;
                    holdingArray[addingTo].properties.speed = speedCategory;
                    holdingArray[addingTo].properties.km += segmentDistance;
                    holdingArray[addingTo].properties.hours += hours;
                    lastTimeStamp = timeEnd;
                  }
                } else { // ## adding to 1
                  if(holdingArray[addingTo].properties.speed === speedCategory){
                    //console.log('adding to one')
                    holdingArray[addingTo].geometry.coordinates.push(segmentStart);
                    holdingArray[addingTo].geometry.coordinates.push(coordinates);
                    holdingArray[addingTo].properties.speed = speedCategory;
                    holdingArray[addingTo].properties.km += segmentDistance;
                    holdingArray[addingTo].properties.hours += hours;
                    lastTimeStamp = timeEnd;
                  } else {
                    // do we think holdingArray 1 should be merged into 0? i.e. it is less than 200m OR shorter than 2 minutes
                    if(holdingArray[0].properties.speed === holdingArray[1].properties.speed || holdingArray[1].properties.km < 0.2 || holdingArray[1].properties.hours < 0.033 ) {
                      //console.log('else1')
                      var slice = holdingArray[1].geometry.coordinates
                      slice.shift(); // cut off the start coordinate since it is shared by the two, dont want duplicate in the one linestring
                      holdingArray[0].geometry.coordinates = holdingArray[0].geometry.coordinates.concat(slice)
                      holdingArray[0].properties.km += holdingArray[1].properties.km;
                      holdingArray[0].properties.hours += holdingArray[1].properties.hours;
                      holdingArray.pop()
                      holdingArray.push(emptyLinestring());
                      holdingArray[addingTo].geometry.coordinates.push(segmentStart);
                      holdingArray[addingTo].geometry.coordinates.push(coordinates);
                      holdingArray[addingTo].properties.date = lastTimeStamp;
                      holdingArray[addingTo].properties.start = lastTimeStamp;
                      holdingArray[addingTo].properties.speed = speedCategory;
                      holdingArray[addingTo].properties.km += segmentDistance;
                      holdingArray[addingTo].properties.hours += hours;
                    } else {
                      //console.log('else2')
                      // dont merge, shift & ship holdingArray[0]
                      holdingArray[0].properties.stroke = (holdingArray[0].properties.speed === 'walk') ? "#0047d3" : "#ed1b2e";
                      holdingArray[0].properties.end = lastTimeStamp;
                      if (holdingArray[0].properties.hours > 0 ) {

                        sql += "INSERT INTO data.gpx (file,day,first,last,speed,km,hours,geom) VALUES (" +
                          "'" + key + "'," +
                          "'" + JSON.stringify(holdingArray[0].properties.date) + "'," +
                          "'" + JSON.stringify(holdingArray[0].properties.start) + "'," +
                          "'" + JSON.stringify(holdingArray[0].properties.end) + "'," +
                          "'" + holdingArray[0].properties.speed + "'," +
                          holdingArray[0].properties.km + "," +
                          holdingArray[0].properties.hours + "," +
                          "ST_GeomFromGeoJSON('{" +
                          '"type":"LineString","coordinates":' +
                          JSON.stringify(holdingArray[0].geometry.coordinates) + "," +
                          '"crs":{"type":"name","properties":{"name":"EPSG:4326"}}}' + "'));";

                      }
                      holdingArray.shift();
                      holdingArray.push(emptyLinestring());
                      holdingArray[addingTo].geometry.coordinates.push(segmentStart);
                      holdingArray[addingTo].geometry.coordinates.push(coordinates);
                      holdingArray[addingTo].properties.date = lastTimeStamp;
                      //holdingArray[addingTo].properties.start = lastTimeStamp;
                      holdingArray[addingTo].properties.speed = speedCategory;
                      holdingArray[addingTo].properties.km += segmentDistance;
                      holdingArray[addingTo].properties.hours += hours;
                    }
                  }
                }
              }

              data.features.forEach(function(element){
                if(element.geometry.type === "MultiLineString"){
                  for(i=0; i<element.geometry.coordinates.length; i++){
                    for(j=0; j<element.geometry.coordinates[i].length; j++){
                      processNextPoint(removeZ(element.geometry.coordinates[i][j]), element.properties.coordTimes[i][j]);
                    }
                  }
                }

                if(element.geometry.type === "LineString"){
                  for(i=0; i<element.geometry.coordinates.length; i++){
                    processNextPoint(removeZ(element.geometry.coordinates[i]), element.properties.coordTimes[i]);
                  }
                }
              });

              holdingArray[0].properties.end = lastTimeStamp;
              holdingArray[0].properties.stroke = (holdingArray[0].properties.speed === 'walk') ? "#0047d3" : "#ed1b2e";


              sql += "INSERT INTO data.gpx (file,day,first,last,speed,km,hours,geom) VALUES (" +
                "'" + key + "'," +
                "'" + JSON.stringify(holdingArray[0].properties.date) + "'," +
                "'" + JSON.stringify(holdingArray[0].properties.start) + "'," +
                "'" + JSON.stringify(holdingArray[0].properties.end) + "'," +
                "'" + holdingArray[0].properties.speed + "'," +
                holdingArray[0].properties.km + "," +
                holdingArray[0].properties.hours + "," +
                "ST_GeomFromGeoJSON('{" +
                '"type":"LineString","coordinates":' +
                JSON.stringify(holdingArray[0].geometry.coordinates) + "," +
                '"crs":{"type":"name","properties":{"name":"EPSG:4326"}}}' + "'));";

              pghelper.query(sql, this.MULTI());
            }

      }

    }, function () {
      console.log('done insert rows');
      cb();
    }

  );

  // execute flow
  insertRows();


}


module.exports = Gpx;
