'use strict';

var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var constants = require('*/cartridge/adyen/config/constants');
var bmHelper = require('*/cartridge/utils/helper');
function fetchAllStores() {
    var service = bmHelper.initializeAdyenService(constants.SERVICE.GETSTORES, 'GET');
    var merchantAccount = AdyenConfigs.getAdyenMerchantAccount();
    var stores = [];
    var nextPageUrl = service.getURL();
    while (nextPageUrl) {
        var callResult = service.call(
            JSON.stringify({
                merchantAccount
            })
        );
        if (!callResult.isOk()) {
            throw new Error('/getStores call failed');
        }
        var response = JSON.parse(callResult.object.getText());
        stores = stores.concat(
            response.data.map(({ id, reference }) => ({
                id,
                reference
            }))
        );
        nextPageUrl = ((response._links || {}).next || {}).href || null;
        if (nextPageUrl) {
            service.setURL(nextPageUrl);
        }
    }
    return stores;
}
module.exports = {
    fetchAllStores
};
