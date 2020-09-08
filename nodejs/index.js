var express = require('express')
var shell = require('shelljs')
var app = express()
var _ = require('lodash')
var request = require('request')
var progress = require('request-progress')
var fs = require('fs')
const path = require('path')

var bodyParser = require('body-parser')
// Imports the Google Cloud client library
const {Storage} = require('@google-cloud/storage');

// signed url lives for this long
const expiryDays = 7  // 7 is the max

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }))

// parse application/json
app.use(bodyParser.json())

app.get('/', function(req, res) {
	res.send(JSON.stringify({response: 'ok'}))
})



 /**
  * Called from twilio-vodeo.js:twilioCallback()
  * This is where we download the composition file from twilio
  * When we're done, we make a post request back to the firebase function twilio-vodeo.js:downloadComplete()
  */
app.post('/downloadComposition', function(req, res) {

	/**
	 Passed in from twilio-video.js:twilioCallback() - 'composition-available' section


	"RoomSid": "RMa538d10712f334f4830f7694483f952d", 
	"twilio_account_sid": "see twilio", 
	"twilio_auth_token": "see twilio", 
	"domain": "video.twilio.com", 
	"MediaUri": "/v1/Compositions/CJ2601577fa348e97e367f218417e49920/Media", 
	"CompositionSid": "CJ2601577fa348e97e367f218417e49920", 
	"Ttl": 3600, 
	"firebase_functions_host": "xxxxxxxxx.cloudfunctions.net", 
	"firebase_function": "/downloadComplete",
     website_domain_name: req.query.website_domain_name
    */

    var twilioUrl = `https://${req.body.twilio_account_sid}:${req.body.twilio_auth_token}@video.twilio.com${req.body.MediaUri}?Ttl=${req.body.Ttl}`
    //var twilioUrl = `https://video.twilio.com${req.body.MediaUri}?Ttl=${req.body.Ttl}`
	var compositionFile = `/home/bdunklau/videos/${req.body.CompositionSid}.mp4`


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
			//return res.send(JSON.stringify({compositionFile: compositionFile})) // could probably just return {res: 'ok'}

			let formData = {
				compositionFile: compositionFile,
				CompositionSid: req.body.CompositionSid,
				RoomSid: req.body.RoomSid,
				tempEditFolder:  `/home/bdunklau/videos/${req.body.CompositionSid}`,
				downloadComplete: true,
				website_domain_name: req.body.website_domain_name
			}

			request.post(
				{
					url: `https://${req.body.firebase_functions_host}${req.body.firebase_function}`,  //  firebase function  /downloadComplete
					json: formData // 'json' attr name is KEY HERE, don't use 'form'
				},
				function (err, httpResponse, body) {
					if(err) {
						// can only send back 2xx responses because of twilio
						return res.status(200).send(JSON.stringify({"error": err, "vm url": `https://${req.body.firebase_functions_host}${req.body.firebase_function}`}));
					}
					//console.log(err, body);
					else return res.status(200).send(JSON.stringify({"result": "ok"}));
				}
			);


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
            compositionFile: req.body.compositionFile,
            tempEditFolder: req.body.tempEditFolder,
            CompositionSid:  req.body.CompositionSid,
            roomObj: roomDoc.data(),
            phones: phones,
            firebase_functions_host: settingsObj.data().firebase_functions_host,
            cloud_host: settingsObj.data().cloud_host,
			callbackUrl: `https://${settingsObj.data().firebase_functions_host}/cutVideoComplete`, // just below this function
			compositionProgress: roomDoc.data()['compositionProgress'],
			website_domain_name: req.body.website_domain_name
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
		CompositionSid:  req.body.CompositionSid,
		RoomSid: req.body.roomObj['RoomSid'],
		phones: req.body.phones,
		firebase_functions_host: req.body.firebase_functions_host,
		cloud_host: req.body.cloud_host,  // this host, so we don't have to keep querying config/settings doc
		compositionProgress: req.body.compositionProgress,
		website_domain_name: req.body.website_domain_name
	}

	request.post(
		{
			url: req.body.callbackUrl,  //  firebase function  /cutVideoComplete
			json: formData // 'json' attr name is KEY HERE, don't use 'form'
		},
		function (err, httpResponse, body) {
			if(err) {
				return res.status(500).send(JSON.stringify({"error": err, "vm url": req.body.callbackUrl}));
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
	//DON'T short-circuit anymore   if(true) return res.status(200).send(JSON.stringify({"result": "ok"})); // short-circuit this whole function

    /**
	 * Passed in from /cutVideoComplete
	  
	 
		let formData = {
			compositionFile: req.body.compositionFile,
			CompositionSid:  req.body.CompositionSid,
			RoomSid: req.body.RoomSid,
		    phones: req.body.phones,
			cloud_host: req.body.cloud_host,
			firebase_functions_host: req.body.firebase_functions_host,
			callbackUrl: `https://${req.body.firebase_functions_host}/uploadToFirebaseStorageComplete`, // just below this function
			compositionProgress: compositionProgress,
            website_domain_name: req.body.website_domain_name
		}
	  
	 */


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

	await storage.bucket(bucketName).file(req.body.CompositionSid+'-output.mp4').makePublic();

	/////////////////////////////////////////////////////////////////////////////////////////////
	// SIGNED URL'S AREN'T GOOD FOREVER AND THEY STILL DON'T PLAY IN IPHONE'S <video> TAG
	// SAFARI *WILL* PLAY THE VIDEO SO THAT'S A LITTLE PROGRESS BUT NOT TOTALLY WHAT WE NEED.
	//
	// create signed url...
	// These options will allow temporary read access to the file
	const expiresOn = Date.now() + expiryDays * 24 * 59 * 60 * 1000 // expires in expiryDays days
	const options = {
		version: 'v4',
		action: 'read',
		expires: expiresOn
    }// Get a v4 signed URL for reading the file
	var signedUrl = await storage.bucket(bucketName).file(req.body.CompositionSid+'-output.mp4').getSignedUrl(options);
    if(signedUrl && signedUrl.length > 0) {
		signedUrl = signedUrl[0]
	}


	let formData = {
		compositionFile: req.body.compositionFile,
		CompositionSid:  req.body.CompositionSid,
		RoomSid: req.body.RoomSid,
		phones: req.body.phones,
		videoUrl: signedUrl,
		firebase_functions_host: req.body.firebase_functions_host,
		cloud_host: req.body.cloud_host,  // this host, so we don't have to keep querying config/settings doc
		compositionProgress: req.body.compositionProgress,
        website_domain_name: req.body.website_domain_name
	}

	request.post(
		{
			url: req.body.callbackUrl,  // /uploadToFirebaseStorageComplete
			json: formData // 'json' attr name is KEY HERE, don't use 'form'
		},
		function (err, httpResponse, body) {
			if(err) {
				return res.status(500).send(JSON.stringify({"error": err, "vm url": req.body.callbackUrl}));
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
	//DON'T short-circuit anymore   if(true) return res.status(200).send(JSON.stringify({"result": "ok"})); // short-circuit this whole function

	/**
	  Passed in from /uploadToFirebaseStorageComplete 


	  
		let formData = {
			RoomSid: req.body.RoomSid,
            CompositionSid:  req.body.CompositionSid,
			compositionFile: req.body.compositionFile,
            videoUrl: videoUrl,
		    phones: req.body.phones,
			cloud_host: req.body.cloud_host,
			firebase_functions_host: req.body.firebase_functions_host,
			callbackUrl: `https://${req.body.firebase_functions_host}/deleteVideoComplete`, // just below this function
			compositionProgress: compositionProgress,
            website_domain_name: req.body.website_domain_name
		}

	 */
	
	let origFile = req.body.compositionFile.substring(0, req.body.compositionFile.indexOf("-output"))+".mp4"
	if (shell.exec(`rm ${req.body.compositionFile};rm ${origFile}`).code !== 0) {
		shell.echo(`Error at this command: "${command}"`)
		shell.exit(1)
	}

	let formData = {
		RoomSid: req.body.RoomSid,
		CompositionSid:  req.body.CompositionSid,
		videoUrl: req.body.videoUrl,
		phones: req.body.phones,
		filesDeleted: [req.body.compositionFile, origFile],
		firebase_functions_host: req.body.firebase_functions_host,
		cloud_host: req.body.cloud_host,  // this host, so we don't have to keep querying config/settings doc
		compositionProgress: req.body.compositionProgress,
        website_domain_name: req.body.website_domain_name
	}

	request.post(
		{
			url: req.body.callbackUrl,  //   /deleteVideoComplete
			json: formData // 'json' attr name is KEY HERE, don't use 'form'
		},
		function (err, httpResponse, body) {
			console.log(`AFTER GOING TO ${req.body.callbackUrl}:  `, err, body);
			if(err) {
				return res.status(500).send(JSON.stringify({"error": err, "vm url": req.body.callbackUrl}));
			}
			else return res.status(200).send(JSON.stringify({"result": "ok"}));
		}
	);
})


app.all('/download', function(req, res) {
	const file = `/home/bdunklau/videos/${req.query.file}`;
	res.download(file); // Set disposition and send it.
});


app.all('/makepublic', async function(req, res) {
	
	// Creates a client
	const storage = new Storage({
		projectId: 'yourvotecounts-bd737',
		keyFilename: '/home/bdunklau/yourvotecounts-bd737-980dde8224a5.json'
	});

	let bucketName = 'yourvotecounts-bd737.appspot.com'
	let filename = 'CJ67fdd76b78de2a9ec31700019014f5e8-output.mp4'
	await storage.bucket(bucketName).file(filename).makePublic();

	return res.status(200).send(`now public: ${filename}`)
})




app.all('/cors', function(req, res) {
	// Creates a client
	const storage = new Storage({
		projectId: 'yourvotecounts-bd737',
		keyFilename: '/home/bdunklau/yourvotecounts-bd737-980dde8224a5.json'
	});
	
	let bucketName = 'yourvotecounts-bd737.appspot.com'
	const bucket = storage.bucket(bucketName);

	const corsConfiguration = [{maxAgeSeconds: 3600}]; // 1 hour
	bucket.setCorsConfiguration(corsConfiguration);

	//-
	// If the callback is omitted, we'll return a Promise.
	//-
	bucket.setCorsConfiguration(corsConfiguration).then(function(data) {
		const apiResponse = data[0];
		res.status(200).send(apiResponse)
	});
})



app.all('/signUrl', async function(req, res) {
	
	// Creates a client
	const storage = new Storage({
		projectId: 'yourvotecounts-bd737',
		keyFilename: '/home/bdunklau/yourvotecounts-bd737-980dde8224a5.json'
	});
	
	let bucketName = 'yourvotecounts-bd737.appspot.com'
	const bucket = storage.bucket(bucketName);
	
	// create signed url...
	// These options will allow temporary read access to the file
	const expiresOn = Date.now() + expiryDays * 24 * 59 * 60 * 1000 // expires in expiryDays days
	const options = {
		version: 'v4',
		action: 'read',
		expires: expiresOn
    }// Get a v4 signed URL for reading the file
	const signedUrl = await storage.bucket(bucketName).file(req.query.CompositionSid+'-output.mp4').getSignedUrl(options);

	res.status(200).send(JSON.stringify({CompositionSid: req.query.CompositionSid, signedUrl: signedUrl, expires: new Date(expiresOn)}))

})


app.all('/hls', async function(req, res) {
	// req.query.dir,  req.query.CompositionSid
	// upload all .ts files
	// upload the .m3u8 file
	// set them to public

	
	// Creates a client
	const storage = new Storage({
		projectId: 'yourvotecounts-bd737',
		keyFilename: '/home/bdunklau/yourvotecounts-bd737-980dde8224a5.json'
	});





	fs.readdir(req.query.dir, function (err, files) {
		//handling error
		if (err) {
			return console.log('Unable to scan directory '+req.query.dir+' because of this error: ' + err);
		} 
		//listing all files using forEach
		files.forEach(async function (file) {
			//console.log('file is: ', file) // just the file name with no path/dir info
			/************/
			let bucketName = 'yourvotecounts-bd737.appspot.com'
			// Uploads a local file to the bucket
			await storage.bucket(bucketName).upload(req.query.dir+"/"+file, {
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

			await storage.bucket(bucketName).file(req.query.dir+"/"+file).makePublic();
                          /**********/





		}); // end:  files.forEach(function (file)
		res.status(200).send('files uploaded')
	});



})







app.listen(7000, function() {
    console.log('app listening on port 7000')
})
