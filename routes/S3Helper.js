
// path = require('path'),
var pg = require('pg'),
localConfig = require('../config');
var path = require('path');
var fs = require('fs');

var AWS = require('aws-sdk');
var s3 = new AWS.S3();

var S3Helper = function() {

};

S3Helper.prototype.backupGpx = function(filePath, cb) {

  var body = fs.createReadStream(filePath);
  var key = localConfig.s3.gpxFolder + path.basename(filePath);

  s3.upload({Body: body, Bucket: localConfig.s3.bucket, Key: key}).
    on('httpUploadProgress', function(evt) {
      console.log(evt);
    }).
    send(function(err, data) {
      fs.unlinkSync(filePath);
      cb(err, data)
    });

}

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







module.exports = S3Helper;
