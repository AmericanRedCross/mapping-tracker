var turf = require('turf');
var fs = require('fs');

// [minX, minY, maxX, maxY]
var bbox = [-13.42529296875,6.555474602201889,-8.19580078125,10.325727872188288];
var cellWidth = 3;
var units = 'kilometers';

var hexgrid = turf.hexGrid(bbox, cellWidth, units);

fs.writeFile("./hex.geojson", JSON.stringify(hexgrid))
