'use strict';

var LineItemHelper = require('*/cartridge/adyen/utils/lineItemHelper');
var __RiskDataHelper = {
    createBasketContentFields(order) {
        var productLines = order.getProductLineItems().toArray();
        var itemNr = 1;
        var basketData = {};
        // eslint-disable-next-line complexity
        productLines.forEach((item) => {
            var quantity = LineItemHelper.getQuantity(item);
            basketData[`riskdata.basket.item${itemNr}.itemID`] = LineItemHelper.getId(item);
            basketData[`riskdata.basket.item${itemNr}.productTitle`] = LineItemHelper.getDescription(item);
            basketData[`riskdata.basket.item${itemNr}.amountPerItem`] = LineItemHelper.getItemAmount(item).divide(quantity).value.toFixed();
            basketData[`riskdata.basket.item${itemNr}.currency`] = item.adjustedNetPrice.currencyCode;
            basketData[`riskdata.basket.item${itemNr}.upc`] = item.product ? item.product.UPC : '';
            basketData[`riskdata.basket.item${itemNr}.sku`] = item.product ? item.product.manufacturerSKU : '';
            basketData[`riskdata.basket.item${itemNr}.brand`] = item.product ? item.product.brand : '';
            basketData[`riskdata.basket.item${itemNr}.manufacturer`] = item.product ? item.product.manufacturerName : '';
            basketData[`riskdata.basket.item${itemNr}.category`] =
                item.product && item.product.primaryCategory ? item.product.primaryCategory.displayName : '';
            basketData[`riskdata.basket.item${itemNr}.quantity`] = quantity;
            itemNr++;
        });
        return basketData;
    }
};
module.exports = __RiskDataHelper;
