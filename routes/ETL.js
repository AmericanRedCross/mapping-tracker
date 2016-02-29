var pg = require('pg'),
path = require('path'),
localConfig = require('../config'),
flow = require('flow'),
multer  = require('multer');

// var PostGresHelper = require("./PostGresHelper.js");
// var pghelper = new PostGresHelper();

var S3Helper = require("./S3Helper.js");
var s3helper = new S3Helper();

var Gpx = require("../routes/Gpx.js");
var gpx = new Gpx();


var ETL = function() {

}

ETL.prototype.run = function(uploads, cb){

  var self = this;

  self.files = uploads;

  var processUploads = flow.define(

    function() {
      console.log('step 1')
      this.cb = cb;

      for(var item in uploads){
        gpx.convertFile(uploads[item], this.MULTI());
      }

    },
    function(){
      console.log('step 2')
      gpx.segmentTracks(this);
    },
    function(){
      console.log('step 3')
      for(var item in uploads){
        s3helper.backupGpx(uploads[item].path, this.MULTI());
      }
    },
    function(){
      console.log("Finished.");
      this.cb();
    }

  );

  processUploads();

}

module.exports = ETL;
