var pg = require('pg'),
path = require('path'),
localConfig = require('../config'),
flow = require('flow'),
multer  = require('multer');

var S3Helper = require("./S3Helper.js");
var s3helper = new S3Helper();

var Gpx = require("../routes/Gpx.js");
var gpx = new Gpx();

var Surveys = require("../routes/Surveys.js");
var surveys = new Surveys();

var ETL = function() {

}

ETL.prototype.runGpx = function(uploads, cb){

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


ETL.prototype.runSurvey = flow.define(

    function(cb) {

      this.cb = cb;

      surveys.downloadAllData(this);

    },
    function(){

      surveys.processSurveys(this);

    },
    function(){

      console.log('done the runSurvey bit');
      this.cb();
    }

);

module.exports = ETL;
