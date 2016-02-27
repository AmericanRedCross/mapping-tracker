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
      "first": '',
      "last": '',
      "km": 0,
      "hours": 0,
      "speed": ''
    })
  }

  var removeZ = function(latlng){
    if(latlng.length = 3){ latlng.pop(); }
    return latlng;
  }

  var insertRows = flow.define(
    function () {

      for(var key in self.featureCollections) {

            var sql = "";

            var data = self.featureCollections[key];

            if(data.features){
              var analyzeLine = function(times, coords){
                console.log("analyzeLine")

                var addingTo = 0;
                var holdingArray = [ emptyLinestring(), emptyLinestring() ];

                var previousTime;

                holdingArray[0].geometry.coordinates.push(removeZ(coords[0]));
                holdingArray[0].properties.first = new Date(times[0]);
                previousTime = new Date(times[0]);

                for(i=1; i<times.length; i++){
                  var segmentStart = holdingArray[addingTo].geometry.coordinates[holdingArray[addingTo].geometry.coordinates.length - 1];
                  var segmentDistance = turf.distance(turf.point(segmentStart), turf.point(removeZ(coords[i])), 'kilometers');
                  var timeEnd = new Date(times[i]);
                  var hours = (Math.abs(timeEnd - previousTime) === 0) ? 0 : Math.abs(timeEnd - previousTime) / 3.6e6;
                  var speed = (segmentDistance > 0 && hours > 0) ? segmentDistance / hours : 0;
                  var speedCategory = (speed > 6.5) ? 'moto' : 'walk';

                  if(addingTo === 0 && holdingArray[addingTo].geometry.coordinates.length === 1){
                    holdingArray[addingTo].properties.speed = speedCategory;
                  }
                  // ## Add to the first line segment until the speed changes
                  if(addingTo === 0){
                    if(holdingArray[addingTo].properties.speed === speedCategory){
                      //console.log('adding to zero')
                      holdingArray[addingTo].geometry.coordinates.push(removeZ(coords[i]));
                      holdingArray[addingTo].properties.km += segmentDistance;
                      holdingArray[addingTo].properties.hours += hours;
                      holdingArray[addingTo].properties.last = timeEnd;

                      previousTime = timeEnd;
                    } else {
                      // ## been adding to 0, speed switches, start adding to 1
                      //console.log("switch to 1");
                      addingTo = 1
                      holdingArray[addingTo].geometry.coordinates.push(segmentStart);
                      holdingArray[addingTo].geometry.coordinates.push(removeZ(coords[i]));
                      holdingArray[addingTo].properties.first = previousTime;
                      holdingArray[addingTo].properties.last = timeEnd;
                      holdingArray[addingTo].properties.speed = speedCategory;
                      holdingArray[addingTo].properties.km += segmentDistance;
                      holdingArray[addingTo].properties.hours += hours;
                      previousTime = timeEnd;
                    }
                  } else { // ## adding to 1
                    if(holdingArray[addingTo].properties.speed === speedCategory){
                      //console.log('adding to one')
                      holdingArray[addingTo].geometry.coordinates.push(removeZ(coords[i]));
                      holdingArray[addingTo].properties.km += segmentDistance;
                      holdingArray[addingTo].properties.hours += hours;
                      holdingArray[addingTo].properties.last = timeEnd;
                      previousTime = timeEnd;
                    } else {
                      // do we think holdingArray 1 should be merged into 0? i.e. it is less than 200m OR shorter than 2 minutes
                      if(holdingArray[0].properties.speed === holdingArray[1].properties.speed || holdingArray[1].properties.km < 0.2 || holdingArray[1].properties.hours < 0.033 ) {
                        //console.log('else1')
                        var slice = holdingArray[1].geometry.coordinates
                        slice.shift(); // cut off the start coordinate since it is shared by the two, dont want duplicate in the one linestring
                        holdingArray[0].geometry.coordinates = holdingArray[0].geometry.coordinates.concat(slice)
                        holdingArray[0].properties.km += holdingArray[1].properties.km;
                        holdingArray[0].properties.hours += holdingArray[1].properties.hours;
                        holdingArray[0].properties.last = holdingArray[1].properties.last;
                        holdingArray.pop()
                        holdingArray.push(emptyLinestring());
                        holdingArray[addingTo].geometry.coordinates.push(segmentStart);
                        holdingArray[addingTo].geometry.coordinates.push(removeZ(coords[i]));
                        holdingArray[addingTo].properties.first = previousTime;
                        holdingArray[addingTo].properties.last = timeEnd;
                        holdingArray[addingTo].properties.speed = speedCategory;
                        holdingArray[addingTo].properties.km += segmentDistance;
                        holdingArray[addingTo].properties.hours += hours;
                        previousTime = timeEnd;
                      } else {
                        // console.log('else2')
                        // dont merge, shift & ship holdingArray[0]
                        // // holdingArray[0].properties.stroke = (holdingArray[0].properties.speed === 'walk') ? "#0047d3" : "#ed1b2e";
                        // // holdingArray[0].properties.minutes = holdingArray[0].properties.hours * 60;

                        if (holdingArray[0].properties.hours > 0 ) {

                          // // testOutput.features.push(holdingArray[0]);
                          sql += "INSERT INTO data.gpx (file,first,last,km,hours,speed,geom) VALUES (" +
                            "'" + key + "'," +
                            "'" + JSON.stringify(holdingArray[0].properties.first) + "'," +
                            "'" + JSON.stringify(holdingArray[0].properties.last) + "'," +
                            holdingArray[0].properties.km + "," +
                            holdingArray[0].properties.hours + "," +
                            "'" + holdingArray[0].properties.speed + "'," +
                            "ST_GeomFromGeoJSON('{" +
                            '"type":"LineString","coordinates":' +
                            JSON.stringify(holdingArray[0].geometry.coordinates) + "," +
                            '"crs":{"type":"name","properties":{"name":"EPSG:4326"}}}' + "'));";

                        }
                        holdingArray.shift();
                        holdingArray.push(emptyLinestring());
                        holdingArray[addingTo].geometry.coordinates.push(segmentStart);
                        holdingArray[addingTo].geometry.coordinates.push(removeZ(coords[i]));
                        holdingArray[addingTo].properties.first = previousTime;
                        holdingArray[addingTo].properties.last = timeEnd;
                        holdingArray[addingTo].properties.speed = speedCategory;
                        holdingArray[addingTo].properties.km += segmentDistance;
                        holdingArray[addingTo].properties.hours += hours;
                        previousTime = timeEnd;
                      }
                    }
                  }
                }


                // // holdingArray[0].properties.stroke = (holdingArray[0].properties.speed === 'walk') ? "#0047d3" : "#ed1b2e";
                // // holdingArray[0].properties.minutes = holdingArray[0].properties.hours * 60;
                // // testOutput.features.push(holdingArray[0]);
                sql += "INSERT INTO data.gpx (file,first,last,km,hours,speed,geom) VALUES (" +
                  "'" + key + "'," +
                  "'" + JSON.stringify(holdingArray[0].properties.first) + "'," +
                  "'" + JSON.stringify(holdingArray[0].properties.last) + "'," +
                  holdingArray[0].properties.km + "," +
                  holdingArray[0].properties.hours + "," +
                  "'" + holdingArray[0].properties.speed + "'," +
                  "ST_GeomFromGeoJSON('{" +
                  '"type":"LineString","coordinates":' +
                  JSON.stringify(holdingArray[0].geometry.coordinates) + "," +
                  '"crs":{"type":"name","properties":{"name":"EPSG:4326"}}}' + "'));";


              }

              data.features.forEach(function(feature){

                if(feature.geometry.type === "LineString"){
                  analyzeLine(feature.properties.coordTimes, feature.geometry.coordinates);
                } else if (feature.geometry.type === "MultiLineString") {
                  feature.properties.coordTimes.forEach(function(item, index){
                    analyzeLine(feature.properties.coordTimes[index], feature.geometry.coordinates[index])
                  })
                } else {
                  console.log(feature.geometry.type + " is not a LineString or MultiLineString")
                }

              });


              // // fs.writeFile("./segmentation-output-3.geojson", JSON.stringify(testOutput))


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
