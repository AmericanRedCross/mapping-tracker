var flow = require('flow');
var localConfig = require('../config');

var PostGresHelper = require("../routes/PostGresHelper.js");
var pghelper = new PostGresHelper();

// create the empty database during server setup
// `createdb mapping`
// (name should match whatver you set in config.js)

var setup = flow.define(
  function(){

    var sql = "CREATE EXTENSION postgis; CREATE EXTENSION postgis_topology; CREATE SCHEMA data;";
    pghelper.query(sql, this);

  },
  function(){

    var sql = "CREATE TABLE data.gpx " +
      "( " +
          "id      serial primary key, " +
          "file    varchar(75), " +
          "mapper  varchar(50), " +
          "first   timestamp, " +
          "last    timestamp, " +
          "km      numeric, " +
          "hours   numeric, " +
          "speed   char(4) " +
      "); " +
      "SELECT AddGeometryColumn('data','gpx','geom',4326,'LINESTRING',2);"

    pghelper.query(sql, this);

  },
  function(){

    var sql = "CREATE TABLE data.submissions " +
    "( " +
      "id        text primary key, " +
      "uuid      text,"  +
      "formid    text,"  +
      "today     date, " +
      "osmfile   text, " +
      "type      text, " +
      "tags      text " +
    "); " +
    "SELECT AddGeometryColumn('data','submissions','geom',4326,'POINT',2);"

    pghelper.query(sql, this);


  },
  function(){
    console.log("data setup should be done!")
  }
);

setup();
