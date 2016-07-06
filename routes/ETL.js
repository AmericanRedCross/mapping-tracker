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

var PostGresHelper = require("./PostGresHelper.js");
var pghelper = new PostGresHelper();

var ETL = function() {

}

ETL.prototype.runGpx = function(uploads, cb){
  console.log("etl.runGPX start")
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
        if(path.extname(uploads[item].filename) === ".fit") {
          s3helper.backupGpx(uploads[item].path, this.MULTI());
          s3helper.backupGpx(uploads[item].path.slice(0,-4) + ".gpx", this.MULTI());
        } else {
          s3helper.backupGpx(uploads[item].path, this.MULTI());
        }
      }
    },
    function(){
      console.log("Finished.");
      this.cb();
    }

  );

  processUploads();

}


ETL.prototype.runSurvey = function(cb){

  flow.exec(
    function() {

      surveys.downloadAllData(this);

    },
    function(){

      for(var key in surveys.surveys){
        console.log("processery : " + key);
        surveys.insertRows(key, this.MULTI());
      }

    },
    function(){
      console.log("running hex updater")
      var sql = "UPDATE data.hex SET count = t1.total FROM " +
      "( " +
        "SELECT data.hex.id, count(*) AS total " +
        "FROM data.submissions, data.hex WHERE ST_Covers(data.hex.geom, data.submissions.geom) " +
        "AND NOT data.submissions.type='ERROR' GROUP BY data.hex.id " +
      " ) t1 " +
      "WHERE data.hex.id = t1.id;";
      pghelper.query(sql, this);

    },
    function(){

      console.log('done the runSurvey bit');
      cb();
    }
    
  );

}

module.exports = ETL;
