"use strict";

var _excluded = ["customObjects"];
var _defaultProperties, _eventCodeList;
function _objectWithoutPropertiesLoose(r, e) { if (null == r) return {}; var t = {}; for (var n in r) if ({}.hasOwnProperty.call(r, n)) { if (-1 !== e.indexOf(n)) continue; t[n] = r[n]; } return t; }
var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var analyticsConstants = require('*/cartridge/adyen/analytics/constants');
var AnalyticsService = require('*/cartridge/adyen/analytics/analyticsService');
var constants = require('*/cartridge/adyen/config/constants');
var defaultProperties = (_defaultProperties = {
  channel: 'Web',
  platform: 'Web'
}, _defaultProperties[analyticsConstants.eventCode.INFO] = [], _defaultProperties[analyticsConstants.eventCode.LOG] = [], _defaultProperties[analyticsConstants.eventCode.ERROR] = [], _defaultProperties.customObjects = [], _defaultProperties);
var eventCodeList = (_eventCodeList = {}, _eventCodeList[analyticsConstants.eventCode.INFO] = {
  name: analyticsConstants.eventCode.INFO,
  limit: 50
}, _eventCodeList[analyticsConstants.eventCode.ERROR] = {
  name: analyticsConstants.eventCode.ERROR,
  limit: 5
}, _eventCodeList[analyticsConstants.eventCode.LOG] = {
  name: analyticsConstants.eventCode.LOG,
  limit: 10
}, _eventCodeList);
function isRequestObjectFull(requestObject) {
  return Object.keys(eventCodeList).some(key => {
    var eventCode = eventCodeList[key];
    return requestObject[eventCode.name].length >= eventCode.limit;
  });
}
function updateCounter(customObject) {
  try {
    Transaction.wrap(() => {
      customObject.custom.retryCount += 1;
    });
  } catch (e) {
    AdyenLogs.error_log('Error updating counter:', e);
  }
}
function updateProcessingStatus(customObject, status) {
  try {
    Transaction.wrap(() => {
      customObject.custom.processingStatus = status;
    });
  } catch (e) {
    AdyenLogs.error_log('Error updating processingStatus:', e);
  }
}
function addEventObject(customObject, requestObjectList) {
  var _Object$assign2;
  var {
    creationDate,
    custom: event
  } = customObject;
  var requestObject = requestObjectList.slice(-1)[0];
  var eventObject = {
    timestamp: event.eventDate || new Date(creationDate).getTime().toString(),
    type: (event.eventType || {}).value,
    target: event.referenceId,
    id: event.eventId,
    component: event.eventSource
  };
  if ((event.eventCode || {}).value === analyticsConstants.eventCode.ERROR) {
    delete eventObject.type;
    delete eventObject.target;
    eventObject.errorType = analyticsConstants.errorType;
  }
  if (!isRequestObjectFull(requestObject)) {
    var _Object$assign;
    return [].concat(requestObjectList.slice(0, -1), [Object.assign({}, defaultProperties, requestObject, (_Object$assign = {}, _Object$assign[event.eventCode] = requestObject[event.eventCode].concat([Object.assign({}, eventObject)]), _Object$assign.customObjects = requestObject.customObjects.concat([customObject]), _Object$assign))]);
  }
  return [].concat(requestObjectList, [Object.assign({}, defaultProperties, (_Object$assign2 = {}, _Object$assign2[event.eventCode] = [].concat([Object.assign({}, eventObject)]), _Object$assign2.customObjects = [].concat([customObject]), _Object$assign2))]);
}
function sendAnalyticsEvents(requestObjectList, attemptId) {
  if (attemptId === undefined) {
    attemptId = null;
  }
  requestObjectList.forEach(requestObject => {
    var {
        customObjects
      } = requestObject,
      request = _objectWithoutPropertiesLoose(requestObject, _excluded);
    var submission = attemptId ? AnalyticsService.submitData(request, attemptId) : AnalyticsService.submitData(request);
    if (submission.data) {
      customObjects.forEach(customObject => {
        updateProcessingStatus(customObject, analyticsConstants.processingStatus.PROCESSED);
      });
    } else {
      customObjects.forEach(customObject => {
        if (customObject.custom.retryCount >= analyticsConstants.MAX_RETRY_COUNT) {
          updateProcessingStatus(customObject, analyticsConstants.processingStatus.SKIPPED);
        } else {
          updateCounter(customObject);
        }
      });
      throw new Error('Failed to submit full payload for grouped objects.');
    }
  });
}
function processIncompatibleEventsByVersion(incompatibleEvents) {
  // Group events by version
  var eventsByVersion = {};
  incompatibleEvents.forEach(customObject => {
    var {
      version
    } = customObject.custom;
    if (!eventsByVersion[version]) {
      eventsByVersion[version] = [];
    }
    eventsByVersion[version].push(customObject);
  });

  // Process each version group
  Object.keys(eventsByVersion).forEach(version => {
    var eventsForVersion = eventsByVersion[version];
    try {
      // Create checkout attempt ID with the specific version
      var checkoutAttemptResult = AnalyticsService.createCheckoutAttemptId(version);
      if (!checkoutAttemptResult.data) {
        throw new Error(`Failed to create checkout attempt ID for version ${version}`);
      }

      // Create request object for this version
      var versionRequestObjectList = [];
      versionRequestObjectList.push(Object.assign({}, defaultProperties));
      eventsForVersion.forEach(customObject => {
        versionRequestObjectList = addEventObject(customObject, versionRequestObjectList);
      });

      // Send events for this version
      sendAnalyticsEvents(versionRequestObjectList, checkoutAttemptResult.data);
    } catch (error) {
      AdyenLogs.error_log(`Error processing incompatible events for version ${version}:`, error);
      // Mark events as skipped if processing fails
      eventsForVersion.forEach(customObject => {
        updateProcessingStatus(customObject, analyticsConstants.processingStatus.SKIPPED);
      });
    }
  });
}
function createAnalyticsRequest(customObjectIterator) {
  var counter = 0;
  var requestObjectList = [];
  requestObjectList.push(Object.assign({}, defaultProperties));
  var currentPluginVersion = constants.VERSION;
  var incompatibleEvents = [];
  while (customObjectIterator.hasNext()) {
    if (counter >= analyticsConstants.EVENT_LIMIT) {
      break;
    }
    var customObject = customObjectIterator.next();

    // Check if event version matches current plugin version
    if (customObject.custom.version === currentPluginVersion) {
      requestObjectList = addEventObject(customObject, requestObjectList);
      counter++;
    } else {
      // Store events with different versions for later processing
      incompatibleEvents.push(customObject);
    }
  }

  // Process incompatible events by their versions
  if (incompatibleEvents.length > 0) {
    processIncompatibleEventsByVersion(incompatibleEvents);
  }
  return requestObjectList;
}
function processEvents(customObjectId) {
  var query = 'custom.processingStatus = {0}';
  var queryArgs = [analyticsConstants.processingStatus.NOT_PROCESSED];
  var customObjectIterator = null;
  try {
    customObjectIterator = CustomObjectMgr.queryCustomObjects(customObjectId, query, null, queryArgs);
    var analyticsRequest = createAnalyticsRequest(customObjectIterator);
    sendAnalyticsEvents(analyticsRequest);
  } catch (e) {
    AdyenLogs.error_log('Error querying custom objects:', e);
    throw e;
  } finally {
    if (customObjectIterator) {
      customObjectIterator.close();
    }
  }
}
function clearEvents(customObjectId) {
  var customObjectIterator = null;
  try {
    var query = 'custom.processingStatus = {0} OR custom.processingStatus = {1}';
    var queryArgs = [analyticsConstants.processingStatus.SKIPPED, analyticsConstants.processingStatus.PROCESSED];
    customObjectIterator = CustomObjectMgr.queryCustomObjects(customObjectId, query, null, queryArgs);
    var _loop = function () {
      var customObject = customObjectIterator.next();
      Transaction.wrap(() => {
        CustomObjectMgr.remove(customObject);
      });
    };
    while (customObjectIterator.hasNext()) {
      _loop();
    }
  } catch (e) {
    AdyenLogs.error_log(`Error clearing events for ${customObjectId}:`, e);
  } finally {
    if (customObjectIterator) {
      customObjectIterator.close();
    }
  }
}
module.exports = {
  processEvents,
  clearEvents
};