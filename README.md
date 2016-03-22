### mapping-tracker
A work in progress tool for monitoring the progress of submissions to forms hosted on an instance of [OpenMapKitServer](https://github.com/AmericanRedCross/OpenMapKitServer). Uses a PostGIS database to store submission points, a grid for analysis, and track information from gpx traces.  

- clone the git repository
- `sudo npm install` to get all the node modules
- change the permissions of the tmp folder so the app can write to it `sudo chown -R ubuntu:ubuntu /mapping-tracker/tmp/`
- create a config.js file from config.js.example and adjust settings for your deployment
- start mongo and postgres
- create the a postgres database with name `mapping`
- put a .geojson file of your analysis frid in `setup/`
- run `setup/dataSetup.js` (Postgis extensions are setup here) then `setup/hexSetup.js`
- install gpsbabel
- install [PM2](https://github.com/Unitech/pm2) `sudo npm install pm2 -g`
  - other tools will let you keep the application up and running on your server (e.g. [Forever](https://github.com/foreverjs/forever))
- `pm2 start server.js`
- login (user: default / pass: 123),create a new superuser, and delete the default

To have the Asset Manager restart itself after a reboot, server downtime, etc., you can generate a startup script. Check the [PM2 documentation](https://github.com/Unitech/pm2#startup-script-generation) on this for more details.
