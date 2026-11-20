"use strict";

var File = require('dw/io/File');
var FileReader = require('dw/io/FileReader');
var XMLStreamReader = require('dw/io/XMLStreamReader');
var XMLStreamConstants = require('dw/io/XMLStreamConstants');
var Status = require('dw/system/Status');
var analyticsEvent = require('*/cartridge/adyen/analytics/analyticsEvents');
var analyticsConstants = require('*/cartridge/adyen/analytics/constants');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
function searchForServiceCredential(xmlStreamReader, serviceIdToFind) {
  while (xmlStreamReader.hasNext()) {
    if (xmlStreamReader.next() === XMLStreamConstants.START_ELEMENT) {
      var elementName = xmlStreamReader.getLocalName();
      if (elementName === 'service-credential') {
        var currentServiceId = xmlStreamReader.getAttributeValue(null, 'service-credential-id');
        if (currentServiceId === serviceIdToFind) {
          return true;
        }
      }
    }
  }
  return false;
}
function hasServiceCredential(servicesXmlFile, serviceIdToFind) {
  if (!servicesXmlFile || !servicesXmlFile.exists() || !serviceIdToFind) {
    return false;
  }
  var fileReader = null;
  var xmlStreamReader = null;
  var isFound = false;
  try {
    fileReader = new FileReader(servicesXmlFile, 'UTF-8');
    xmlStreamReader = new XMLStreamReader(fileReader);
    isFound = searchForServiceCredential(xmlStreamReader, serviceIdToFind);
  } catch (error) {
    AdyenLogs.error_log('Error parsing services.xml', error);
    isFound = false;
  } finally {
    xmlStreamReader && xmlStreamReader.close();
    fileReader && fileReader.close();
  }
  return isFound;
}
function deleteDirectoryRecursive(directory) {
  var files = directory.listFiles();
  if (files.empty) {
    directory.remove();
    return;
  }
  var fileIterator = files.iterator();
  while (fileIterator.hasNext()) {
    var file = fileIterator.next();
    if (file.isDirectory()) {
      deleteDirectoryRecursive(file);
    } else {
      file.remove();
    }
  }
  directory.remove();
}
function createConfigEventIfAdyenServiceExist(currentZipFile, tempUnzipDir) {
  var extractedFiles = tempUnzipDir.listFiles();
  var extractedFileIterator = extractedFiles.iterator();
  var isAdyenDefined = false;
  while (extractedFileIterator.hasNext()) {
    var extractedFile = extractedFileIterator.next();
    if (!extractedFile.isFile()) {
      var servicesFile = new File(`${tempUnzipDir.getFullPath()}/${extractedFile.getName()}/services.xml`);
      if (hasServiceCredential(servicesFile, 'AdyenPayment')) {
        isAdyenDefined = true;
        break;
      }
    }
  }
  if (isAdyenDefined) {
    analyticsEvent.createConfigurationTimeEvent(analyticsConstants.eventReference.METADATA_UPLOAD, analyticsConstants.eventSource.CONFIGURATION_TIME, analyticsConstants.eventType.EXPECTED_START, analyticsConstants.eventCode.INFO, currentZipFile.lastModified());
  }
}
function iterateZipFiles(files) {
  var fileIterator = files.iterator();
  while (fileIterator.hasNext()) {
    var currentZipFile = fileIterator.next();
    if (currentZipFile.isFile()) {
      var isZipFile = currentZipFile.getName().toLowerCase().endsWith('.zip');
      if (isZipFile) {
        var tempUnzipDir = new File(`IMPEX/src/instance/${currentZipFile.getName()}_unzipped_temp`);
        if (tempUnzipDir.exists()) {
          deleteDirectoryRecursive(tempUnzipDir);
        }
        tempUnzipDir.mkdirs();
        currentZipFile.unzip(tempUnzipDir);
        createConfigEventIfAdyenServiceExist(currentZipFile, tempUnzipDir);
        deleteDirectoryRecursive(tempUnzipDir);
      }
    }
  }
}
function run() {
  try {
    var targetDir = new File('IMPEX/src/instance');
    var files = targetDir.listFiles();
    iterateZipFiles(files);
  } catch (err) {
    AdyenLogs.error_log(`Error processing targetDir`, err);
  }
  return new Status(Status.OK, 'SUCCESS', `Files in IMPEX/src/instance processed.`);
}
module.exports = {
  run
};