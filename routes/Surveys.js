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

  var getSubmissions = flow.define(
    function(){
      for(var key in self.surveyList) {
        console.log("fetchData for : " + self.surveyList[key])
        self.fetchData(self.surveyList[key], this.MULTI());
      }
    },
    function(){
      console.log('done downloading all data')
      //When all are complete, fire callback
      cb();
    }
  )
  //Trigger the flow
  getSubmissions();

}

Surveys.prototype.fetchData = function(survey, cb) {

  var self = this;
  var url = localConfig.omk.server + "/submissions/" + survey + ".json";
  console.log("url: " + url)
  request(url, function(error,response,body){
    if (!error && response.statusCode == 200) {
      var jsonResponse = JSON.parse(body);
      self.surveys[survey] = jsonResponse;
      console.log("success w fetch for: " + survey) // Show the HTML for the Google homepage.

      cb(survey);
    } else {
      console.log(error);
      console.log("fetch didnt work for: " + survey)
      cb(null);
      return;
    }
  })

}


Surveys.prototype.insertRows = function(key, cb) {

  var self = this;

  var targetCount = 0;
  var counter = 0;
  targetCount = self.surveys[key].length;
  for (var i=0;i<self.surveys[key].length;i++) {
     (function(ind) {
         setTimeout(function(){

           self.insertRow(self.surveys[key][ind], function(err,data){
             counter ++;
             //console.log( key + " . . . " + counter + " ? ? ? " +  self.surveys[key].length)
             if(counter === targetCount){ cb(null, key); }
           });

         }, 100 + (10 * ind));
     })(i);
  }

}



// Surveys.prototype.getGeoPath = function(form, cb) {
//
//   var self = this;
//   var url = localConfig.omk.server + "/public/forms/" + form + ".xml";
//
//   request(url, function(error,response,body){
//     console.log("request to : " + url)
//     var ref = false;
//     if (!error && response.statusCode == 200) {
//       var xmlDoc = new dom().parseFromString(body);
//       if(xpath.select1("//*[@mediatype='osm/*']/@ref", xmlDoc)){
//         var refAttr = xpath.select1("//*[@mediatype='osm/*']/@ref", xmlDoc).value
//         // need to go from something like ""/demo-amenities-nepal/group1/osm_building"
//         // to ["group1", "osm_building"]
//         ref = refAttr.slice(1).split('/');
//         ref.shift();
//       }
//       self.surveys[form].geoPath = ref;
//       cb();
//
//     }
//   });
//
// }


var flattenObject = function(ob) {
	var toReturn = {};

	for (var i in ob) {
		if (!ob.hasOwnProperty(i)) continue;

		if ((typeof ob[i]) == 'object') {
			var flatObject = flattenObject(ob[i]);
			for (var x in flatObject) {
				if (!flatObject.hasOwnProperty(x)) continue;

				toReturn[x] = flatObject[x];
			}
		} else {
			toReturn[i] = ob[i];
		}
	}
	return toReturn;
};






Surveys.prototype.getGeo = function(data, cb) {

  if(data.originalFilename) {
      console.log("originalFilename: " + data.originalFilename)
      // first check for an osm file name from an omk question
      var url = localConfig.omk.server + "/public/submissions/" + data.formId + "/" + data.instanceId.slice(5) + "/" + data.originalFilename;
      request(url, function(error,response,body){
        if (!error && response.statusCode == 200) {
          var xmlOsm = new dom().parseFromString(body);
          var geojsonOsm = osmtogeojson(xmlOsm);
          var category = "";
          // need to check that geojsonOsm has exactly 1 feature
          // # # # # # # #
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
          var geo = turf.centroid(geojsonOsm.features[0]);
          var tags = JSON.stringify(geojsonOsm.features[0].properties.tags);
          cb(null, geo, category, tags);
        } else {
          console.log("ERROR trying to get: " + url)
          var geo = turf.featurecollection([turf.point([0,0])]);
          cb(null, geo, "ERROR");
        }
      })
  } else if (data.latitude && data.longitude) {
      // then check for data from an odk geopoint question
      var geo = turf.point([data.longitude, data.latitude]);
      cb(null, geo, "odk-geopoint");
  } else {
      // otherwise return a [0,0] point
      console.log("ERROR: no geo data found for " + data.instanceId.slice(5));
      var geo = turf.point([0,0]);
      cb(null, geo, "ERROR");
  }

  // if(geojsonOsm.features.length > 1){ console.log("ERROR: whoa, " + flattenObject(dataObj)["originalFilename"] + "has more than one feature??? (we're using the first one)")}
  // if(geojsonOsm.features.length === 0){
  //   console.log("ERROR: whoa, " + flattenObject(dataObj)["originalFilename"] + "had no features???")
  //   centroidFeature = turf.point([0,0]);
  // }

}

Surveys.prototype.insertRow = function(dataObj, cb) {

    var self = this;
    // console.log("my dataObj = " + dataObj)
    // console.log(" stringify = " + JSON.stringify(dataObj))
    var data = flattenObject(dataObj);

    var insert = flow.define(
      function(){

        self.getGeo(data, this);

      },
      function(err, geo, category, tags){

        // console.log("geo : " + JSON.stringify(geo))
        // console.log("category : " + category)

        var sql = "INSERT INTO data.submissions (uuid,today,osmfile,type,tags,geom) VALUES (" +
          "'" + data.instanceId.slice(5) + "'," +
          "'" + data.today + "'," +
          "'" + data.originalFilename + "'," +
          "'" + category + "'," +
          "'" + tags + "'," +
          "ST_GeomFromGeoJSON('{" +
          '"type":"Point","coordinates":' +
          JSON.stringify(geo.geometry.coordinates) + "," +
          '"crs":{"type":"name","properties":{"name":"EPSG:4326"}}}' + "'));";

        pghelper.query(sql, this);

      },
      function(){
        //console.log('done inserting')

        cb();
      }
    );

    insert();

}


module.exports = Surveys;
