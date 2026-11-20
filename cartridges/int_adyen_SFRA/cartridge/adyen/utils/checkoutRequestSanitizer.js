"use strict";

var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var V72_FIELD_LIMITS = {
  REFERENCE: 80,
  RETURN_URL: 1024,
  SHOPPER_EMAIL: 256,
  SHOPPER_IP: 256,
  SHOPPER_NAME: 100,
  TELEPHONE_NUMBER: 64,
  SOCIAL_SECURITY_NUMBER: 50,
  POSTAL_CODE: 10,
  BILLING_STATE_OR_PROVINCE: 10,
  CAPTURE_DELAY_HOURS: 672,
  METADATA_KEY: 20,
  METADATA_VALUE: 80
};
var ENTITY_TYPES = ['NaturalPerson', 'CompanyName'];
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
var ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;
var ALPHA_2 = /^[A-Za-z]{2}$/;
var STATE_OR_PROVINCE_PLACEHOLDER = 'N/A';
var QUOTED_LOCAL_PART = /^"(?:[^"\\]|\\.)*"$/;
var PERCENT_ESCAPE = /(%[0-9A-Fa-f]{2})/;
var HIGH_SURROGATE = /[\uD800-\uDBFF]$/;
function emailLocalPart(email) {
  return email.substring(0, email.lastIndexOf('@'));
}
function emailDomain(email) {
  return email.substring(email.lastIndexOf('@') + 1);
}
var EMAIL_REJECTIONS = [email => email.length > V72_FIELD_LIMITS.SHOPPER_EMAIL, email => email.indexOf(' ') > -1, email => email.lastIndexOf('@') < 1, email => email.lastIndexOf('@') === email.length - 1, email => emailDomain(email).charAt(0) === '.', email => emailLocalPart(email).indexOf('"') > -1 && !QUOTED_LOCAL_PART.test(emailLocalPart(email))];
function isValidShopperEmail(email) {
  return !EMAIL_REJECTIONS.some(isRejected => isRejected(email));
}
function toIsoDate(value) {
  var isoPrefix = ISO_DATE_PREFIX.exec(value);
  if (isoPrefix) {
    return isoPrefix[1];
  }
  var timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  // Local accessors on purpose: Date.parse reads a non-ISO value as local
  // midnight, so reading it back in UTC would shift the date by a day.
  var date = new Date(timestamp);
  var month = `0${date.getMonth() + 1}`.slice(-2);
  var day = `0${date.getDate()}`.slice(-2);
  return `${date.getFullYear()}-${month}-${day}`;
}
function cut(value, maxLength) {
  // Drops a trailing high surrogate so the cut never splits a surrogate pair
  // into an unpaired code unit.
  return value.substring(0, maxLength).replace(HIGH_SURROGATE, '');
}
function truncate(container, key, maxLength, path) {
  var value = container[key];
  if (typeof value !== 'string' || value.length <= maxLength) {
    return;
  }
  container[key] = cut(value, maxLength);
  AdyenLogs.info_log(`Checkout v72: truncated ${path} from ${value.length} to ${maxLength} characters`);
}
function truncateRule(maxLength) {
  return (container, key, path) => truncate(container, key, maxLength, path);
}
function applyReference(container, key, path) {
  var value = container[key];
  if (typeof value !== 'string' || value.length <= V72_FIELD_LIMITS.REFERENCE) {
    return;
  }
  // Sent unmodified on purpose: this is the order number that webhooks are
  // matched against, so a truncated value would orphan the notification.
  AdyenLogs.error_log(`Checkout v72: ${path} is sent unmodified`, `length ${value.length} exceeds the ${V72_FIELD_LIMITS.REFERENCE} character limit`);
}
function encodeOnce(value) {
  // Encoding around the existing percent-escapes keeps this idempotent; a plain
  // encodeURI would turn an already encoded '%20' into '%2520'.
  return value.split(PERCENT_ESCAPE).map((part, index) => index % 2 ? part : encodeURI(part)).join('');
}
function applyReturnUrl(container, key, path) {
  var value = container[key];
  if (typeof value !== 'string') {
    return;
  }
  var encoded = encodeOnce(value);
  if (encoded !== value) {
    container[key] = encoded;
    AdyenLogs.info_log(`Checkout v72: encoded unsafe characters in ${path}`);
  }
  if (encoded.length > V72_FIELD_LIMITS.RETURN_URL) {
    // Truncating would break the redirect back to the storefront.
    AdyenLogs.error_log(`Checkout v72: ${path} is sent unmodified`, `length ${encoded.length} exceeds the ${V72_FIELD_LIMITS.RETURN_URL} character limit`);
  }
}
function applyShopperEmail(container, key, path) {
  var value = container[key];
  if (typeof value !== 'string') {
    return;
  }
  // Trimmed before validating so that a padded address is repaired rather than
  // dropped: v72 rejects spaces, and losing the email weakens fraud scoring and
  // hard-fails the payment methods that require it.
  var trimmed = value.trim();
  if (isValidShopperEmail(trimmed)) {
    if (trimmed !== value) {
      container[key] = trimmed;
      AdyenLogs.info_log(`Checkout v72: trimmed whitespace around ${path}`);
    }
    return;
  }
  delete container[key];
  AdyenLogs.error_log(`Checkout v72: dropped ${path}, invalid format or over ${V72_FIELD_LIMITS.SHOPPER_EMAIL} characters (length ${value.length})`);
}
function applyDateOfBirth(container, key, path) {
  var value = container[key];
  if (typeof value !== 'string' || ISO_DATE.test(value)) {
    return;
  }
  var isoDate = toIsoDate(value);
  if (!isoDate) {
    delete container[key];
    AdyenLogs.error_log(`Checkout v72: dropped ${path}, not parseable as a date (length ${value.length})`);
    return;
  }
  container[key] = isoDate;
  AdyenLogs.info_log(`Checkout v72: reformatted ${path} to YYYY-MM-DD`);
}
function logUnmodifiedStateOrProvince(path, value, requirement) {
  // Neither dropped nor truncated: stateOrProvince is a required address field,
  // so deleting it turns a format rejection into a misleading "not provided"
  // rejection, and truncating turns "Queensland" into the valid-looking but
  // wrong "QU", which produces a silent AVS partial match.
  AdyenLogs.error_log(`Checkout v72: ${path} is sent unmodified`, `${requirement} (length ${value.length})`);
}
function applyBillingStateOrProvince(container, key, path) {
  var value = container[key];
  if (typeof value !== 'string' || value.length <= V72_FIELD_LIMITS.BILLING_STATE_OR_PROVINCE) {
    return;
  }
  logUnmodifiedStateOrProvince(path, value, `over ${V72_FIELD_LIMITS.BILLING_STATE_OR_PROVINCE} characters`);
}
function applyDeliveryStateOrProvince(container, key, path) {
  var value = container[key];
  // The placeholder is what the address builders send for countries that have
  // no state or province, where the field is required but has no valid code.
  if (typeof value !== 'string' || value === STATE_OR_PROVINCE_PLACEHOLDER) {
    return;
  }
  if (ALPHA_2.test(value)) {
    container[key] = value.toUpperCase();
    return;
  }
  logUnmodifiedStateOrProvince(path, value, 'not an ISO 3166-1 alpha-2 code');
}
function applyEntityType(container, key, path) {
  var value = container[key];
  if (typeof value !== 'string' || ENTITY_TYPES.indexOf(value) > -1) {
    return;
  }
  delete container[key];
  AdyenLogs.error_log(`Checkout v72: dropped ${path}, expected one of ${ENTITY_TYPES.join(', ')}`);
}
function applyCaptureDelayHours(container, key, path) {
  var value = container[key];
  if (typeof value !== 'number' || value <= V72_FIELD_LIMITS.CAPTURE_DELAY_HOURS) {
    return;
  }
  container[key] = V72_FIELD_LIMITS.CAPTURE_DELAY_HOURS;
  AdyenLogs.info_log(`Checkout v72: clamped ${path} to ${V72_FIELD_LIMITS.CAPTURE_DELAY_HOURS}`);
}
function truncateMetadataEntry(target, metadata, metadataKey, path) {
  var truncatedKey = cut(metadataKey, V72_FIELD_LIMITS.METADATA_KEY);
  var value = metadata[metadataKey];
  if (Object.prototype.hasOwnProperty.call(target, truncatedKey)) {
    AdyenLogs.error_log(`Checkout v72: dropped ${path} entry, its key collides with another entry once truncated to ${V72_FIELD_LIMITS.METADATA_KEY} characters`);
    return true;
  }
  target[truncatedKey] = typeof value === 'string' ? cut(value, V72_FIELD_LIMITS.METADATA_VALUE) : value;
  return truncatedKey !== metadataKey || target[truncatedKey] !== value;
}
function applyMetadata(container, key, path) {
  var metadata = container[key];
  if (!metadata || typeof metadata !== 'object') {
    return;
  }
  // Null-prototype accumulator so that a '__proto__' key is emitted as a plain
  // entry instead of disappearing into the prototype setter.
  var truncated = Object.create(null);
  var coerced = Object.keys(metadata).filter(metadataKey => truncateMetadataEntry(truncated, metadata, metadataKey, path));
  container[key] = truncated;
  if (coerced.length) {
    AdyenLogs.info_log(`Checkout v72: coerced ${coerced.length} ${path} entries to a ${V72_FIELD_LIMITS.METADATA_KEY} character key and a ${V72_FIELD_LIMITS.METADATA_VALUE} character value`);
  }
}
var FIELD_RULES = [{
  path: ['reference'],
  apply: applyReference
}, {
  path: ['returnUrl'],
  apply: applyReturnUrl
}, {
  path: ['shopperEmail'],
  apply: applyShopperEmail
}, {
  path: ['shopperIP'],
  apply: truncateRule(V72_FIELD_LIMITS.SHOPPER_IP)
}, {
  path: ['shopperName', 'firstName'],
  apply: truncateRule(V72_FIELD_LIMITS.SHOPPER_NAME)
}, {
  path: ['shopperName', 'lastName'],
  apply: truncateRule(V72_FIELD_LIMITS.SHOPPER_NAME)
}, {
  path: ['telephoneNumber'],
  apply: truncateRule(V72_FIELD_LIMITS.TELEPHONE_NUMBER)
}, {
  path: ['socialSecurityNumber'],
  apply: truncateRule(V72_FIELD_LIMITS.SOCIAL_SECURITY_NUMBER)
}, {
  path: ['dateOfBirth'],
  apply: applyDateOfBirth
}, {
  path: ['billingAddress', 'postalCode'],
  apply: truncateRule(V72_FIELD_LIMITS.POSTAL_CODE)
}, {
  path: ['deliveryAddress', 'postalCode'],
  apply: truncateRule(V72_FIELD_LIMITS.POSTAL_CODE)
}, {
  path: ['billingAddress', 'stateOrProvince'],
  apply: applyBillingStateOrProvince
}, {
  path: ['deliveryAddress', 'stateOrProvince'],
  apply: applyDeliveryStateOrProvince
}, {
  path: ['entityType'],
  apply: applyEntityType
}, {
  path: ['captureDelayHours'],
  apply: applyCaptureDelayHours
}, {
  path: ['metadata'],
  apply: applyMetadata
}];
function resolveContainer(request, path) {
  var container = request;
  for (var i = 0; i < path.length - 1; i++) {
    container = container[path[i]];
    if (!container || typeof container !== 'object') {
      return null;
    }
  }
  return container;
}
function applyRule(request, rule) {
  var container = resolveContainer(request, rule.path);
  if (container) {
    rule.apply(container, rule.path[rule.path.length - 1], rule.path.join('.'));
  }
}
function sanitizeRequest(requestObject) {
  try {
    var sanitized = JSON.parse(JSON.stringify(requestObject));
    FIELD_RULES.forEach(rule => applyRule(sanitized, rule));
    return sanitized;
  } catch (e) {
    AdyenLogs.error_log('Checkout v72: could not sanitize the request, sending it unmodified', e);
    return requestObject;
  }
}
module.exports = {
  V72_FIELD_LIMITS,
  sanitizeRequest
};