
// path = require('path'),
var pg = require('pg'),
localConfig = require('../config');
var path = require('path');

var AWS = require('aws-sdk');
var s3 = new AWS.S3();

var S3Helper = function() {

};

S3Helper.prototype.listGpx = function(cb) {


  var listParams = {
    Bucket: localConfig.s3.bucket,
    Prefix: localConfig.s3.gpxFolder
  };
  s3.listObjects(listParams, function(err, data) {
    if(err){
      console.log(err, err.stack); // an error occurred
    }

    cb(err, data.Contents);
  });
}

S3Helper.prototype.moveProcessedGpx = function(fileKey, cb) {

  var copyParams = {
    Bucket: localConfig.s3.bucket,
    CopySource:  localConfig.s3.bucket + '/' + fileKey,
    Key: localConfig.s3.gpxFolder + 'processed/' + path.basename(fileKey)
  };
  var deleteParams = {  Bucket: localConfig.s3.bucket, Key: fileKey };

  s3.copyObject(copyParams, function(err, data){
    if (err) console.log(err, err.stack);
    else {
      s3.deleteObject(deleteParams, function(err, data) {
        if (err) console.log(err, err.stack);  // error
        cb(err, data);
      });

    }
  });

}






module.exports = S3Helper;
