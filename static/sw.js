var CACHE_NAME = 'offline-form';
var FOLDER_NAME = 'post_requests'
var IDB_VERSION = 1
var form_data
var urlsToCache = [
  '/',
  '/static/style.css',
  '/static/script.js',
  "https://cdnjs.cloudflare.com/ajax/libs/semantic-ui/1.11.8/semantic.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/jquery/2.1.3/jquery.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/semantic-ui/1.11.8/semantic.min.js"
];

self.addEventListener('install', function(event) {
  // install file needed offline
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

function getObjectStore (storeName, mode) {
  return our_db.transaction(storeName, mode).objectStore(storeName)
}

function savePostRequests (url, payload) {
  var request = getObjectStore(FOLDER_NAME, 'readwrite').add({
    url: url,
    payload: payload,
    method: 'POST'
  })
  request.onsuccess = function (event) {
    console.log('a new pos_ request has been added to indexedb')
  }

  request.onerror = function (error) {
    console.error(error)
  }
}

function openDatabase () {
  // if `flask-form` does not already exist in our browser (under our site), it is created
  var indexedDBOpenRequest = indexedDB.open('flask-form', )

  indexedDBOpenRequest.onerror = function (error) {
    // errpr creatimg db
    console.error('IndexedDB error:', error)
  }

  
  indexedDBOpenRequest.onupgradeneeded = function () {
    // This should only execute if there's a need to create/update db.
    this.result.createObjectStore(FOLDER_NAME, { autoIncrement: true, keyPath: 'id' })
  }

  // This will execute each time the database is opened.
  indexedDBOpenRequest.onsuccess = function () {
    our_db = this.result
  }
}

var our_db
openDatabase()

self.addEventListener('fetch', function(event) {
  // every request from our site, passes through the fetch handler
  // I have proof
  console.log('I am a request with url: ', event.request.clone().url)
  if (event.request.method === 'GET') {
    event.respondWith(
      // check all the caches in the browser and find
      // out whether our request is in any of them
      caches.match(event.request)
        .then(function(response) {
          if (response) {
            // if we are here, that means there's a match
            //return the response stored in browser
            return response;
          }
          // no match in cache, use the network instead
          return fetch(event.request);
        }
      )
    );
  } else if (event.request.clone().method === 'POST') {
    // attempt to send request normally
    console.log('form_data', form_data)
    event.respondWith(fetch(event.request.clone()).catch(function (error) {
      // only save post requests in browser, if an error occurs
      savePostRequests(event.request.clone().url, form_data)
    }))
  }
});

self.addEventListener('message', function (event) {
  console.log('form data', event.data)
  if (event.data.hasOwnProperty('form_data')) {
    // receives file data from form.js upon upload
    // from file selection
    form_data = event.data.form_data
  }
})

function sendPostToServer () {
  var savedRequests = []
  var req = getObjectStore(FOLDER_NAME).openCursor() // FOLDERNAME = 'post_requests'

  req.onsuccess = async function (event) {
    var cursor = event.target.result

    if (cursor) {
      // Keep moving the cursor forward and collecting saved requests.
      savedRequests.push(cursor.value)
      cursor.continue()
    } else {
      // At this point, we have collected all the post requests in indexedb.
        for (let savedRequest of savedRequests) {
          // send them to the server one after the other
          console.log('saved request', savedRequest)
          var requestUrl = savedRequest.url
          var payload = JSON.stringify(savedRequest.payload)
          var method = savedRequest.method
          var headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          } // if you have any other headers put them here
          fetch(requestUrl, {
            headers: headers,
            method: method,
            body: payload
          }).then(function (response) {
            console.log('server response', response)
            if (response.status < 400) {
              // If sending the POST request was successful, then remove it from the IndexedDB.
              getObjectStore(FOLDER_NAME, 'readwrite').delete(savedRequest.id)
            } 
          }).catch(function (error) {
            // This will be triggered if the network is still down. The request will be replayed again
            // the next time the service worker starts up.
            console.error('Send to Server failed:', error)
            // since we are in a catch, it is important an error is thrown,
            // so the background sync knows to keep retrying sendto server
            throw error
          })
        }
    }
  }
}


self.addEventListener('sync', function (event) {
  console.log('now online')
  if (event.tag === 'sendFormData') { // event.tag name checked here must be the same as the one used while registering sync
    event.waitUntil(
      // Send our POST request to the server, now that the user is online
      sendPostToServer()
      )
  }
})
