var express = require('express')
var shell = require('shelljs')
var app = express()
var _ = require('lodash')
var request = require('request')
var progress = require('request-progress')
var fs = require('fs')

var bodyParser = require('body-parser')
// Imports the Google Cloud client library
const {Storage} = require('@google-cloud/storage');


// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }))

// parse application/json
app.use(bodyParser.json())

app.get('/', function(req, res) {
	res.send(JSON.stringify({response: 'ok'}))
})


/**
 * THIS CURL COMMAND IS NOT CORRECT.  
 * SEE formData BELOW FOR THE CORRECT LIST OF FORM PARAMETERS PASSED IN

 */

 /**
  * Called from twilio-vodeo.js:twilioCallback()
  * This is where we download the composition file from twilio
  * When we're done, we make a post request back to the firebase function twilio-vodeo.js:downloadComplete()
  */
app.get('/downloadComposition', function(req, res) {

    var twilioUrl = `https://${req.query.twilio_account_sid}:${req.query.twilio_auth_token}@video.twilio.com${req.query.MediaUri}?Ttl=${req.query.Ttl}`
	var compositionFile = `/home/bdunklau/videos/${req.query.CompositionSid}.mp4`


    // ref:  https://stackoverflow.com/questions/44896984/what-is-way-to-download-big-file-in-nodejs
    progress(request(twilioUrl, {/* parameters */}))
    .on('progress', function(state) {
	})
	.on('error', function(err) {
	    if(err) {
	        res.send(JSON.stringify({error: err, when: 'on error'}))	
	    }
	})
	.on('end', function() {
	})
	.pipe(
	    fs.createWriteStream(compositionFile).on('finish', function() {
			return res.send(JSON.stringify({compositionFile: compositionFile})) // could probably just return {res: 'ok'}
		})
	)

}) 



/**
 * Called from twilio-video.js:downloadComplete()
 * See the page "Marking Time"
 * See video-call.component.ts: the start stop pause and resume recording functions
 */
app.all('/cutVideo', function(req, res) {
	if(req.query.test) {
		res.status(200).send(JSON.stringify({"test": req.query.test}))
		return
	}

	/*******
	 form data from twilio-video.js:downloadComplete()
	 
        let formData = {
            compositionFile: compositionFile,
            tempEditFolder: req.body.tempEditFolder,
            roomObj: roomObj
        }
	******/

	let mkdir = `mkdir ${req.body.tempEditFolder}`
	console.log('req.body = ', req.body);
	console.log('req.body.roomObj = ', req.body.roomObj);
    let ffmpegCommands = _.map(req.body.roomObj['mark_time'], (timeStuff, index) => {
		return `ffmpeg -i ${req.body.compositionFile} -ss ${timeStuff.start_recording} -t ${timeStuff.duration} ${req.body.tempEditFolder}/part${index}.mp4`
	})
	
	/**
	 * Creates an inputs.txt file that has this:
	 * file 'part0.mp4'
	 * file 'part1.mp4'
	 * file 'part2.mp4'
	 * etc
	 */
    let buildInputsFile = _.map(req.body.roomObj['mark_time'], (timeStuff, index) => {
		return `echo "file 'part${index}.mp4'" >> ${req.body.tempEditFolder}/inputs.txt`
	})

	let compFileWithoutMP4 = req.body.compositionFile.substring(0, req.body.compositionFile.indexOf(".mp4"))
	let compositionFile = `${compFileWithoutMP4}-output.mp4`
	let concatCommand = `ffmpeg -f concat -i ${req.body.tempEditFolder}/inputs.txt -c copy ${compositionFile}`

	let rmdir = `rm -rf ${req.body.tempEditFolder}`
	let commands = _.flatten( [mkdir, ffmpegCommands, `touch ${req.body.tempEditFolder}/inputs.txt`, buildInputsFile, concatCommand, rmdir] )

	_.each(commands, command => {
		console.log('command: ', command)
	})

	let commandRes = []
	_.each(commands, command => {
		if (shell.exec(command).code !== 0) {
		  shell.echo(`Error at this command: "${command}"`)
		  shell.exit(1)
		  commandRes.push(command)
		}

	})

	let formData = {
		compositionFile: compositionFile,
		firebase_functions_host: req.body.firebase_functions_host,
		cloud_host: req.body.cloud_host  // this host, so we don't have to keep querying config/settings doc
	}

	request.post(
		{
			url: req.body.callbackUrl,  //  firebase function  /cutVideoComplete
			json: formData // 'json' attr name is KEY HERE, don't use 'form'
		},
		function (err, httpResponse, body) {
			if(err) {
				return res.status(500).send(JSON.stringify({"error": err, "vm url": vmUrl}));
			}
			//console.log(err, body);
			else return res.status(200).send(JSON.stringify({"result": "ok"}));
		}
	);

})


/**
 * Called from /cutVideoComplete
 * /cutVideoComplete is called by /cutVideo, which is just above this function
 */
app.all('/uploadToFirebaseStorage', async function(req, res) {
	// Creates a client
	const storage = new Storage({
		projectId: 'yourvotecounts-bd737',
		keyFilename: '/home/bdunklau/yourvotecounts-bd737-980dde8224a5.json'
	});

	let bucketName = 'yourvotecounts-bd737.appspot.com'
	// Uploads a local file to the bucket
    await storage.bucket(bucketName).upload(req.body.compositionFile, {
		// Support for HTTP requests made with `Accept-Encoding: gzip`
		gzip: true,
		// By setting the option `destination`, you can change the name of the
		// object you are uploading to a bucket.
		metadata: {
		  // Enable long-lived HTTP caching headers
		  // Use only if the contents of the file will never change
		  // (If the contents will change, use cacheControl: 'no-cache')
		  cacheControl: 'public, max-age=31536000',
		},
	});


	let formData = {
		compositionFile: req.body.compositionFile,
		firebase_functions_host: req.body.firebase_functions_host,
		cloud_host: req.body.cloud_host  // this host, so we don't have to keep querying config/settings doc
	}

	request.post(
		{
			url: req.body.callbackUrl,
			json: formData // 'json' attr name is KEY HERE, don't use 'form'
		},
		function (err, httpResponse, body) {
			if(err) {
				return res.status(500).send(JSON.stringify({"error": err, "vm url": vmUrl}));
			}
			//console.log(err, body);
			else return res.status(200).send(JSON.stringify({"result": "ok"}));
		}
	);
  

	//return res.status(200).send(JSON.stringify({"result": `uploaded ${req.query.file}`}))

})


/**
 * Delete both the original composition file and the -output.mp4 composition file
 */
app.all('/deleteVideo', async function(req, res) {
	
	let origFile = req.body.compositionFile.substring(0, req.body.compositionFile.indexOf("-output"))+".mp4"
	if (shell.exec(`rm ${req.body.compositionFile};rm ${origFile}`).code !== 0) {
		shell.echo(`Error at this command: "${command}"`)
		shell.exit(1)
	}

	let formData = {
		filesDeleted: [req.body.compositionFile, origFile],
		firebase_functions_host: req.body.firebase_functions_host,
		cloud_host: req.body.cloud_host  // this host, so we don't have to keep querying config/settings doc
	}

	request.post(
		{
			url: req.body.callbackUrl,
			json: formData // 'json' attr name is KEY HERE, don't use 'form'
		},
		function (err, httpResponse, body) {
			if(err) {
				return res.status(500).send(JSON.stringify({"error": err, "vm url": vmUrl}));
			}
			//console.log(err, body);
			else return res.status(200).send(JSON.stringify({"result": "ok"}));
		}
	);
})


app.all('/tempDownload', function(req, res) {
	const file = `/home/bdunklau/videos/${req.query.file}`;
	res.download(file); // Set disposition and send it.
});


app.listen(7000, function() {
    console.log('app listening on port 7000')
})
