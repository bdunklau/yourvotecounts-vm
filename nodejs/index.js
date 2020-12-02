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



/**
 * Returns the heap used up in GB
 * Ref:   https://github.com/Data-Wrangling-with-JavaScript/nodejs-memory-test/blob/master/index.js
 */
var heapUsed = function() {
	const mu = process.memoryUsage();
	const mbNow = mu['heapUsed'] / 1024 / 1024 / 1024;
	const heap = Math.round(mbNow * 100) / 100
	return heap
}


/**
 * Do we care about this?
 * Will return the complete url
 */
function getUrl(req) {
    return req.protocol + '://' + req.get('host') + req.originalUrl;
}



/**
 * NOTE ON MIDDLEWARE ********************************************************
 * Execution of middleware is dependent on the order they are declared here
 * 
 * So if they are declared in this order:
 *    app.use('/', (req, res, next) => {})
 *    app.use('/test', (req, res, next) => {})
 * 
 * Then the output will look like this:
 * 		[before next()]  path:  /
		[before next()]  path:  /test
		[after next()]   path:  /test
		[after next()]   path:  /
 
    If the middleware is declared in this order:
 *    app.use('/test', (req, res, next) => {})
 *    app.use('/', (req, res, next) => {})
 * 
 * Then the output will look like this:
 * 		[before next()]  path:  /test
		[before next()]  path:  /
		[after next()]   path:  /
		[after next()]   path:  /test
 */


 /**
  * Middleware
  */
app.use('/', (req, res, next) => {
	// console.log('[before next()]  path:  /')
	next()
	// console.log('[after next()]   path:  /')

    /**
	 * YOU CANNOT ADD ANYTHING TO THE RESPONSE AFTER next() BECAUSE WE HAVE ALREADY CALLED
	 * res.send()
	 * YOU WOULD HAVE TO USE res.write() BUT WE DON'T REALLY NEED TO WRITE THE HEAP USED OR THE
	 * SIZE OF THE nohup.out FILE.  WE JUST NEED TO TAKE APPROPRIATE ACTION WHEN THEIR SIZES
	 * CROSS CERTAIN THRESHOLDS
	 */

	/**
	 * Check heapUsed
	 */
	var heap = heapUsed()

	/**
	 * If heapUsed is greater than req.body.heapThreshold
	 */
	const heapThreshold = req.body.heapThreshold ? parseFloat(req.body.heapThreshold) : 1 /* GB */
	if(heap > heapThreshold) {
		// call the fb function that will trigger an SMS message to me
		notifyHeapWarning({heapUsed: heap, req: req, res: res})
	}

	// res.end()  // NEEDS TO BE IN THE TOP-MOST MIDDLEWARE DECLARATION
	//return   // doesn't appear to be needed
})


/**
 * call the fb function that will trigger an SMS message to me
 */
function notifyHeapWarning(args) {
    
	let formData = {
		heapUsed: args.heapUsed,
		heapThreshold: args.req.body.heapThreshold,
		firebase_functions_host: args.req.body.firebase_functions_host,
		website_domain_name: args.req.body.website_domain_name
	}

	request.post(
		{
			url: `https://${args.req.body.firebase_functions_host}/notifyHeapWarning`,
			json: formData // 'json' attr name is KEY HERE, don't use 'form'
		},
		function (err, httpResponse, body) {
			// TODO what here?  Can't do res.send() because that's already been called
			// return args.res.status(200).send(JSON.stringify({"result": "ok"}));
		}
	);
}



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
				compositionFile: compositionFile, // ex:  "/home/bdxxxxxxxx/videos/CJaab95xxxxxxxxxxxxxxc0c718dc4630.mp4"
				CompositionSid: req.body.CompositionSid,
				RoomSid: req.body.RoomSid,
				tempEditFolder:  `/home/bdunklau/videos/${req.body.CompositionSid}`,
				downloadComplete: true,
				website_domain_name: req.body.website_domain_name
			}
			if(req.body.stop) formData['stop'] = true

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
					else {
						let theResult = {"result": "downloadComposition complete", 
										 compositionFile: compositionFile,
										 CompositionSid: req.body.CompositionSid}
						console.log('/downloadComposition:  ', theResult)
						return res.status(200).send(JSON.stringify(theResult));
					}
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
			website_domain_name: req.body.website_domain_name,
            projectId: req.body.projectId,
            storage_keyfile: req.body.storage_keyfile
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
	let outputFile = `${compFileWithoutMP4}-output.mp4`
	let concatCommand = `ffmpeg -f concat -i ${req.body.tempEditFolder}/inputs.txt -c copy ${outputFile}`

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
		compositionFile: req.body.compositionFile,
		outputFile: outputFile,
		CompositionSid:  req.body.CompositionSid,
		RoomSid: req.body.roomObj['RoomSid'],
		tempEditFolder: req.body.tempEditFolder,
		phones: req.body.phones,
		firebase_functions_host: req.body.firebase_functions_host,
		cloud_host: req.body.cloud_host,  // this host, so we don't have to keep querying config/settings doc
		compositionProgress: req.body.compositionProgress,
		website_domain_name: req.body.website_domain_name,
		projectId: req.body.projectId,
		storage_keyfile: req.body.storage_keyfile
	}
	if(req.body.stop) formData['stop'] = true

	request.post(
		{
			url: req.body.callbackUrl,  //  firebase function  /cutVideoComplete
			json: formData // 'json' attr name is KEY HERE, don't use 'form'
		},
		function (err, httpResponse, body) {
			if(err) {
				// can't send 500's back - twilio doesn't like that
				return res.status(200).send(JSON.stringify({"error": err, "vm url": req.body.callbackUrl}));
			}
			//console.log(err, body);
			else return res.status(200).send(JSON.stringify({"result": "cutVideo complete"}));
		}
	);

})



app.all('/createHls', async function(req, res) {
    /**
	   mkdir CompositionSid-hls
	   cd CompositionSid-hls
	   ffmpeg -i /home/bdunklau/videos/CJ9b9c4b45bc8f02c9724c0717592073b3.mp4 -c:v h264 -flags +cgop -g 30 -hls_time 10 -hls_list_size 0  -hls_segment_filename 'CJ9b9c4b45bc8f02c9724c0717592073b3%03d.ts' CJ9b9c4b45bc8f02c9724c0717592073b3.m3u8
	   loop over each file in CompositionSid-hls
	   pass the list of .ts, .m3u8 and mp4 files back to the firebase function /createHlsComplete
	 */


	/**
	 /cutVideoComplete passes in this

		let formData = {
		    outputFile: req.body.outputFile,
			compositionFile: req.body.compositionFile,
			CompositionSid:  req.body.CompositionSid,
			RoomSid: req.body.RoomSid,
			tempEditFolder: req.body.tempEditFolder,
			phones: req.body.phones,
			cloud_host: req.body.cloud_host,
			firebase_functions_host: req.body.firebase_functions_host,
			callbackUrl: `https://${req.body.firebase_functions_host}/createHlsComplete`, // just below this function
			compositionProgress: compositionProgress,
			website_domain_name: req.body.website_domain_name,
            projectId: req.body.projectId,
            storage_keyfile: req.body.storage_keyfile
		}
	 
	 */

	let commands = [
		`cd /home/bdunklau/videos`,
		`mkdir ${req.body.CompositionSid}-hls`,
		`cd ${req.body.CompositionSid}-hls`,
		`ffmpeg -i ${req.body.outputFile}  -c:v h264 -flags +cgop -g 30 -hls_time 10 -hls_list_size 0  -hls_segment_filename '${req.body.CompositionSid}%03d.ts' ${req.body.CompositionSid}.m3u8`
	]
	let runTogether = _.join(commands, ";")

	if (shell.exec(runTogether).code !== 0) {
		shell.echo(`Error at this command: "${runTogether}"`)
		shell.exit(1)
	}


	//////////////////////////////////////////////////////////////////////
	//  loop over each file in CompositionSid-hls
	const storage = new Storage({
		projectId: req.body.projectId,
		keyFilename: `/home/bdunklau/${req.body.storage_keyfile}`
	});

	let uploadFiles = [{path: req.body.outputFile, name: `${req.body.CompositionSid}-output.mp4`}]
	let hlsDirectory = `/home/bdunklau/videos/${req.body.CompositionSid}-hls`
	fs.readdir(hlsDirectory, function (err, files) {
		//handling error
		if (err) {
			return console.log('Unable to scan directory '+req.query.dir+' because of this error: ' + err);
			// TODO FIXME do something about this err condition
		} 

		_.each(files, file => {
			uploadFiles.push({path: `${req.body.tempEditFolder}-hls/${file}`, name: file});
		})


		/////////////////////////////////////////////////////////
		// POST BACK TO /createHlsComplete
        let formData = {
		    outputFile: req.body.outputFile,
			compositionFile: req.body.compositionFile,
			uploadFiles: uploadFiles,
			CompositionSid:  req.body.CompositionSid,
			RoomSid: req.body.RoomSid,
			tempEditFolder: req.body.tempEditFolder,
			phones: req.body.phones,
			firebase_functions_host: req.body.firebase_functions_host,
			cloud_host: req.body.cloud_host,  // this host, so we don't have to keep querying config/settings doc
			compositionProgress: req.body.compositionProgress,
			website_domain_name: req.body.website_domain_name,
            projectId: req.body.projectId,
            storage_keyfile: req.body.storage_keyfile
		}
		if(req.body.stop) formData['stop'] = true

		request.post(
			{
				url: req.body.callbackUrl,  //  firebase function  /createHlsComplete
				json: formData // 'json' attr name is KEY HERE, don't use 'form'
			},
			function (err, httpResponse, body) {
				if(err) {
					// can't send 500's back - twilio doesn't like that
					return res.status(200).send(JSON.stringify({"error": err, "vm url": req.body.callbackUrl}));
				}
				//console.log(err, body);
				else return res.status(200).send(JSON.stringify({"result": "createHls complete"}));
			}
		);
		

		//return res.status(200).send('done')

	}); // fs.readdir()
	
	

})





/**
 * Called from /cutVideoComplete
 * /cutVideoComplete is called by /cutVideo, which is just above this function
 */
app.all('/uploadToFirebaseStorage', async function(req, res) {
	//DON'T short-circuit anymore   if(true) return res.status(200).send(JSON.stringify({"result": "ok"})); // short-circuit this whole function

    /**
	 * Passed in from /createHlsComplete
	  
	 
		let formData = {
			outputFile: req.body.outputFile,
			compositionFile: req.body.compositionFile,
			uploadFiles: req.body.uploadFiles,
			CompositionSid:  req.body.CompositionSid,
			RoomSid: req.body.RoomSid,
			tempEditFolder: req.body.tempEditFolder,
			phones: req.body.phones,
			firebase_functions_host: req.body.firebase_functions_host,
			cloud_host: req.body.cloud_host,  // this host, so we don't have to keep querying config/settings doc
            callbackUrl: `https://${req.body.firebase_functions_host}/uploadToFirebaseStorageComplete`, // just below this function
			compositionProgress: req.body.compositionProgress,
			website_domain_name: req.body.website_domain_name,
            projectId: req.body.projectId,
            storage_keyfile: req.body.storage_keyfile
		}
	  
	 */


	// Creates a client
	const storage = new Storage({
		projectId: req.body.projectId,
		keyFilename: `/home/bdunklau/${req.body.storage_keyfile}`
	});

	let bucketName = `${req.body.projectId}.appspot.com`
    _.each(req.body.uploadFiles, async file => {
		// Uploads a local file to the bucket
		let folder = req.body.CompositionSid
		await storage.bucket(bucketName).upload(file.path, {
			destination: folder+"/"+file.name,
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

		await storage.bucket(bucketName).file(folder+"/"+file.name).makePublic();

	})


	let formData = {
		outputFile: req.body.outputFile,
		uploadFiles: req.body.uploadFiles,
		compositionFile: req.body.compositionFile, 
		CompositionSid:  req.body.CompositionSid,
		RoomSid: req.body.RoomSid,
		phones: req.body.phones,
		//videoUrl: signedUrl,
		firebase_functions_host: req.body.firebase_functions_host,
		cloud_host: req.body.cloud_host,  // this host, so we don't have to keep querying config/settings doc
		compositionProgress: req.body.compositionProgress,
        website_domain_name: req.body.website_domain_name,
		projectId: req.body.projectId,
		storage_keyfile: req.body.storage_keyfile
	}
	if(req.body.stop) formData['stop'] = true

	request.post(
		{
			url: req.body.callbackUrl,  // /uploadToFirebaseStorageComplete
			json: formData // 'json' attr name is KEY HERE, don't use 'form'
		},
		function (err, httpResponse, body) {
			if(err) {
				// can't send 500's back - twilio doesn't like that
				return res.status(200).send(JSON.stringify({"error": err, "vm url": req.body.callbackUrl}));
			}
			//console.log(err, body);
			else return res.status(200).send(JSON.stringify({"result": "uploadToFirebaseStorage complete"}));
		}
	);
  

	//return res.status(200).send(JSON.stringify({"result": `uploaded ${req.query.file}`}))

})



app.all('/uploadScreenshotToStorage', async function(req, res) {
    /**
	 * passed in from twilio-video.js:/uploadToFirebaseStorageComplete()	 
			
		let formData = {
			outputFile: req.body.outputFile,
			uploadFiles: req.body.uploadFiles,
			RoomSid: req.body.RoomSid,
			CompositionSid:  req.body.CompositionSid,
			compositionFile: req.body.compositionFile,
			videoUrl: videoUrl,
			videoUrlAlt: videoUrlAlt,
			phones: req.body.phones,
			cloud_host: req.body.cloud_host,
			firebase_functions_host: req.body.firebase_functions_host,
			//callbackUrl: `https://${req.body.firebase_functions_host}/deleteVideoComplete`, // just below this function
			callbackUrl: `https://${req.body.firebase_functions_host}/uploadScreenshotToStorageComplete`, // just below this function
			compositionProgress: req.body.compositionProgress,
			website_domain_name: req.body.website_domain_name,
            projectId: req.body.projectId,
            storage_keyfile: req.body.storage_keyfile
		}
	 */

	 
	let commands = [
		`cd /home/bdunklau/videos`,
		`ffmpeg -i ${req.body.outputFile} -ss 00:00:03 -vframes 1 ${req.body.CompositionSid}.jpg`
	]
	let runTogether = _.join(commands, ";")

	if (shell.exec(runTogether).code !== 0) {
		shell.echo(`Error at this command: "${runTogether}"`)
		shell.exit(1)
	}

	
	// Creates a client
	const storage = new Storage({
		projectId: req.body.projectId,
		keyFilename: `/home/bdunklau/${req.body.storage_keyfile}`
	});

	let bucketName = req.body.projectId+'.appspot.com'
	let folder = req.body.CompositionSid
	let filepath = `/home/bdunklau/videos/${req.body.CompositionSid}.jpg`
	await storage.bucket(bucketName).upload(filepath, {
		destination: `${folder}/${req.body.CompositionSid}.jpg`,
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

	await storage.bucket(bucketName).file(`${folder}/${req.body.CompositionSid}.jpg`).makePublic();

	
	// delete the screenshot after uploading
	let command = `rm /home/bdunklau/videos/${req.body.CompositionSid}.jpg`
	if (shell.exec(command).code !== 0) {
		shell.echo(`Error at this command: "${command}"`)
		shell.exit(1)
	}

	
	let formData = {
		outputFile: req.body.outputFile,
		uploadFiles: req.body.uploadFiles,
		RoomSid: req.body.RoomSid,
		CompositionSid:  req.body.CompositionSid,
		compositionFile: req.body.compositionFile, 
		screenshot: req.body.CompositionSid+".jpg", // just the file name, no path
		phones: req.body.phones,
		//videoUrl: signedUrl,
		firebase_functions_host: req.body.firebase_functions_host,
		cloud_host: req.body.cloud_host,  // this host, so we don't have to keep querying config/settings doc
		compositionProgress: req.body.compositionProgress,
        website_domain_name: req.body.website_domain_name,
		projectId: req.body.projectId,
		storage_keyfile: req.body.storage_keyfile
	}
	if(req.body.stop) formData['stop'] = true

	request.post(
		{
			url: req.body.callbackUrl,  // /uploadScreenshotToStorageComplete
			json: formData // 'json' attr name is KEY HERE, don't use 'form'
		},
		function (err, httpResponse, body) {
			if(err) {
				// can't send 500's back - twilio doesn't like that
				return res.status(200).send(JSON.stringify({"error": err, "vm url": req.body.callbackUrl}));
			}
			//console.log(err, body);
			else return res.status(200).send(JSON.stringify({"result": "uploadScreenshotToStorage complete"}));
		}
	);
})



/**
 * Delete both the original composition file and the -output.mp4 composition file
 */
app.all('/deleteVideo', async function(req, res) {
	//DON'T short-circuit anymore   if(true) return res.status(200).send(JSON.stringify({"result": "ok"})); // short-circuit this whole function

	/**
	  Passed in from /uploadToFirebaseStorageComplete 

	  
		let formData = {
			outputFile: req.body.outputFile,
			uploadFiles: req.body.uploadFiles,
			RoomSid: req.body.RoomSid,
			CompositionSid:  req.body.CompositionSid,
			compositionFile: req.body.compositionFile,
			phones: req.body.phones,
			cloud_host: req.body.cloud_host,
			firebase_functions_host: req.body.firebase_functions_host,
			callbackUrl: `https://${req.body.firebase_functions_host}/deleteVideoComplete`,
		    compositionProgress: req.body.compositionProgress,
			website_domain_name: req.body.website_domain_name,
            projectId: req.body.projectId,
            storage_keyfile: req.body.storage_keyfile
		}

	 */
	
	let deleteThese = [req.body.compositionFile]
    _.each(req.body.uploadFiles, file => {
		deleteThese.push(file.path)
	})
	let deleteCommands = _.map(deleteThese, del => `rm ${del}`)
	deleteCommands.push(`rm -rf /home/bdunklau/videos/${req.body.CompositionSid}-hls`)
	let asSingleCommand = _.join(deleteCommands, ";")

	if (shell.exec(asSingleCommand).code !== 0) {
		shell.echo(`Error at this command: "${asSingleCommand}"`)
		shell.exit(1)
	}

	let formData = {
		RoomSid: req.body.RoomSid,
		CompositionSid:  req.body.CompositionSid,
		phones: req.body.phones,
		filesDeleted: deleteThese,
		firebase_functions_host: req.body.firebase_functions_host,
		cloud_host: req.body.cloud_host,  // this host, so we don't have to keep querying config/settings doc
		compositionProgress: req.body.compositionProgress,
        website_domain_name: req.body.website_domain_name,
		projectId: req.body.projectId,
		storage_keyfile: req.body.storage_keyfile
	}

	request.post(
		{
			url: req.body.callbackUrl,  //   /deleteVideoComplete
			json: formData // 'json' attr name is KEY HERE, don't use 'form'
		},
		function (err, httpResponse, body) {
			console.log(`AFTER GOING TO ${req.body.callbackUrl}:  `, err, body);
			if(err) {
				// can't send 500's back - twilio doesn't like that
				return res.status(200).send(JSON.stringify({"error": err, "vm url": req.body.callbackUrl}));
			}
			else return res.status(200).send(JSON.stringify({"result": "deleteVideo complete"}));
		}
	);
})



app.all('/test', function(req, res) {
	
	res.status(200).send(JSON.stringify({"result": "/test complete"}))
})




app.all('/hi', function(req, res) {
	
	res.status(200).send(JSON.stringify({"hi": "hi"}))
})







app.all('/download', function(req, res) {
	const file = `/home/bdunklau/videos/${req.query.file}`;
	res.download(file); // Set disposition and send it.
});





app.all('/crash', function(req, res) {
	res.status(200).send(JSON.stringify({"crash": "crash"}))
	process.exit(1/*= fatal*/)
})





app.all('/env', async function(req, res) {
    
	res.status(200).send(`env var is: ${req.body.envvar}`)
})




app.listen(7000, function() {
    console.log('app listening on port 7000')
})
