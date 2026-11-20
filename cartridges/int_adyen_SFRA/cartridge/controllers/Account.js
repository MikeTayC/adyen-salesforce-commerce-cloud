"use strict";

var server = require('server');
var {
  updateSavedCards
} = require('*/cartridge/adyen/scripts/payments/updateSavedCards');
server.extend(module.superModule);
var userLoggedIn = require('*/cartridge/scripts/middleware/userLoggedIn');
var consentTracking = require('*/cartridge/scripts/middleware/consentTracking');

/*
 * Prepends Account's 'Show' function to update saved cards.
 */
server.prepend('Show', server.middleware.https, userLoggedIn.validateLoggedIn, consentTracking.consent, (req, res, next) => {
  updateSavedCards({
    CurrentCustomer: req.currentCustomer.raw
  });
  next();
});
module.exports = server.exports();