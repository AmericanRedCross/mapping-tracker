var fs = require('fs');
var path = require('path');
var flow = require('flow');
var localConfig = require('../config');

var PostGresHelper = require("../routes/PostGresHelper.js");
var pghelper = new PostGresHelper();


var setup = flow.define(
  function(){

    var sql = "CREATE TABLE data.hex" +
        "(" +
          "id serial primary key" +
        ");" +
        "SELECT AddGeometryColumn('data','hex','geom',4326,'POLYGON',2);";
    pghelper.query(sql, this);

  },
  function(){

    fs.readFile(path.join(__dirname, "hex.geojson"), this);

  },
  function(err, data){

    if (err) throw err;

    var fc = JSON.parse(data)
    for(var f in fc.features){
      var sql = "INSERT INTO data.hex (geom) VALUES (" +
        "ST_GeomFromGeoJSON('{" +
        '"type":"Polygon","coordinates":' +
        JSON.stringify(fc.features[f].geometry.coordinates) + "," +
        '"crs":{"type":"name","properties":{"name":"EPSG:4326"}}}' + "'));";

      pghelper.query(sql, this.MULTI());
    }

  },
  function(){
    console.log("setup should be done!")
  }
);

setup();
