'use strict';

// script include
var LineItemHelper = require('*/cartridge/adyen/utils/lineItemHelper');
function getLineItems({ Order: order, Basket: basket, addTaxPercentage }) {
    if (!(order || basket)) return null;
    var orderOrBasket = order || basket;
    var allLineItems = LineItemHelper.getAllLineItems(orderOrBasket.getAllLineItems());

    // Add all product and shipping line items to request
    return allLineItems.map((lineItem) => {
        var lineItemObject = {};
        var description = LineItemHelper.getDescription(lineItem);
        var id = LineItemHelper.getId(lineItem);
        var quantity = LineItemHelper.getQuantity(lineItem);
        var itemAmount = LineItemHelper.getItemAmount(lineItem).divide(quantity);
        var vatAmount = LineItemHelper.getVatAmount(lineItem).divide(quantity);
        var vatPercentage = LineItemHelper.getVatPercentage(lineItem);
        lineItemObject.amountExcludingTax = itemAmount.getValue().toFixed();
        lineItemObject.taxAmount = vatAmount.getValue().toFixed();
        lineItemObject.amountIncludingTax = itemAmount.getValue() + vatAmount.getValue();
        lineItemObject.description = description;
        lineItemObject.id = id;
        lineItemObject.quantity = quantity;
        lineItemObject.taxPercentage = addTaxPercentage ? (Number(vatPercentage) * 10000).toFixed() : 0;
        return lineItemObject;
    });
}
module.exports = {
    getLineItems
};
