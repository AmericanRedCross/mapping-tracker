
// path = require('path'),
var pg = require('pg'),
localConfig = require('../config')

var AWS = require('aws-sdk');
var aws = new AWS.S3();

var S3Helper = function() {

};

S3Helper.prototype.listGpx = function(cb) {


  var listParams = {
    Bucket: localConfig.s3.bucket,
    Prefix: localConfig.s3.gpxFolder
  };
  aws.listObjects(listParams, function(err, data) {
    if(err){
      console.log(err, err.stack); // an error occurred
    }

    cb(err, data.Contents);
  });
}



module.exports = S3Helper;
