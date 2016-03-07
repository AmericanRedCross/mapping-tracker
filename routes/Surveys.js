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


Surveys.prototype.processSurveys = function(cb) {

  var self = this;
  //console.log("this . . . " + JSON.stringify(this));
  var counter = 0;
  var insert = flow.define(
    function(){
      for(var key in self.surveys){
        console.log("processery : " + key)
        // if(this.surveys[0] === self.surveys[0]){
        //   console.log("TRUE!")
        // }
       // self.insertRows(key, self.surveys[key], this.MULTI());
       var submissions = self.surveys[key]
       for(var index in submissions){
         counter ++
         self.insertRow(submissions[index], this.MULTI())
       }

      }
    },
    function(){
      console.log("ran insertRow: " + counter + " times!" )
      cb();
    }
  )
  insert();

}


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


http.globalAgent.maxSockets = 1000;

Surveys.prototype.getOsmFile = function(row, cb) {
  //console.log("getOsmFile... ")
  //console.log(row)
  var formId = row.meta.formId;
  var uuid = row.meta.instanceId.slice(5);
  var osmFilename = flattenObject(row)["originalFilename"];
  var url = localConfig.omk.server + "/public/submissions/" + formId + "/" + uuid + "/" + osmFilename;

  var options = {
    host: localConfig.omk.server,
    path: "/public/submissions/" + formId + "/" + uuid + "/" + osmFilename
  };

  http.get(url).on('response', function (response) {
    var body = '';
    response.on('data', function (chunk) {
      body += chunk;
    });
    response.on('end', function () {
      var xmlOsm = new dom().parseFromString(body);
      var geojsonOsm = osmtogeojson(xmlOsm);
      //console.log("got osm file from url: " + url)
      if(geojsonOsm === null){ geojsonOsm = turf.featurecollection([turf.point([0,0])]) }
      var geojsonOsm = turf.featurecollection([turf.point([0,0])]);
      cb(null, geojsonOsm);
    });
  }).on('error', function(e) {
      // console.log("Got error: " + e);
      console.log("ERROR trying to get: " + url)
          var geojsonOsm = turf.featurecollection([turf.point([0,0])]);
          cb(null, geojsonOsm);
  });


  // request(url, function(error,response,body){
  //   if (!error && response.statusCode == 200) {
      // var xmlOsm = new dom().parseFromString(body);
      // var geojsonOsm = osmtogeojson(xmlOsm);
      // if(geojsonOsm === null){ geojsonOsm = turf.featurecollection([turf.point([0,0])]) }
  //     //console.log("got osm file . . . " + JSON.stringify(geojsonOsm))
  //     console.log("got osm file from url: " + url)
  //     //console.log("success w getSubmissions for: " + survey) // Show the HTML for the Google homepage.
  //     cb(null, geojsonOsm);
  //   } else {
  //     //console.log("ERROR: getOsmFile didnt work for: " + JSON.stringify(row));
  //     console.log(error)
  //     console.log("with the url: " + url);
  //     var geojsonOsm = turf.featurecollection([turf.point([0,0])]);
  //     cb(null, geojsonOsm);
  //   }
  // })


}

Surveys.prototype.insertRow = function(dataObj, cb) {

    var self = this;
    // console.log("my dataObj = " + dataObj)

    var insert = flow.define(
      function(){
        //console.log('insert a row using : ' + JSON.stringify(submission))
        self.getOsmFile(dataObj, this);

      },
      function(err, geojsonOsm){

        var omkType = '';
        var tags = '';
        var centroidFeature;
        // console.log("geojsonOsm: " + JSON.stringify(geojsonOsm))
        if(geojsonOsm.features.length > 1){ console.log("ERROR: whoa, " + flattenObject(dataObj)["originalFilename"] + "has more than one feature??? (we're using the first one)")}
        if(geojsonOsm.features.length === 0){
          console.log("ERROR: whoa, " + flattenObject(dataObj)["originalFilename"] + "had no features???")
          centroidFeature = turf.point([0,0]);
        } else {
          //console.log("length of features: " + geojsonOsm.features.length)
          //console.log(JSON.stringify(geojsonOsm))
          tags = JSON.stringify(geojsonOsm.features[0].properties.tags);
          switch(geojsonOsm.features[0].geometry.type) {
            case "Polygon":
              omkType = 'polygon';
              centroidFeature = turf.centroid(geojsonOsm.features[0]);
              break;
            case "Point":
            omkType = 'point/aoi';
              centroidFeature = geojsonOsm.features[0];
              break;
            default:
              console.log("ERROR: unknown geojsonOsm feature type");
              centroidFeature = turf.point([0,0]);
          }
        }

        var sql = "INSERT INTO data.submissions (uuid,osmfile,type,tags,geom) VALUES (" +
          "'" + dataObj.meta.instanceId.slice(5) + "'," +
          "'" + flattenObject(dataObj)["originalFilename"] + "'," +
          "'" + omkType + "'," +
          "'" + tags + "'," +
          "ST_GeomFromGeoJSON('{" +
          '"type":"Point","coordinates":' +
          JSON.stringify(centroidFeature.geometry.coordinates) + "," +
          '"crs":{"type":"name","properties":{"name":"EPSG:4326"}}}' + "'));";
          //console.log(JSON.stringify(centroidFeature.geometry.coordinates))
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
