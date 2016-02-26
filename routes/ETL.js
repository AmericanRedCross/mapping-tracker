var pg = require('pg'),
path = require('path'),
localConfig = require('../config'),
flow = require('flow');

// var PostGresHelper = require("./PostGresHelper.js");
// var pghelper = new PostGresHelper();

var S3Helper = require("./S3Helper.js");
var s3helper = new S3Helper();

var Gpx = require("../routes/Gpx.js");
var gpx = new Gpx();


var ETL = function() {

}

ETL.prototype.run = flow.define(

  function(cb) {
    console.log('step 1')
    this.cb = cb;

    //Go get the file list.  When we've finished, flow to the next function block
    gpx.fetchFilelist(this);

  },
  function(err, data) {
    console.log('step 2')
    //For each gpx file, pull down the data, converting from gpx to geojson in the process
    gpx.fetchAllData(this);

  },
  function(){
    console.log('step 3')
    gpx.segmentTracks(this);
  },
  function(){
    console.log('step 4')
    for(var key in gpx.featureCollections){
      s3helper.moveProcessedGpx(key, this.MULTI());
    }
  },
  function(){
    console.log("Finished.");
    this.cb();
  }

);

module.exports = ETL;
