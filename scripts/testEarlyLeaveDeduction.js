const assert = require('node:assert/strict');
const Leave = require('../src/modules/leave/leave.model');

const deductionEnumValues = Leave.schema.obj.leaveDeductionType.enum;
const categoryEnumValues = Leave.schema.obj.category.enum;

assert.ok(deductionEnumValues.includes('EARLY_LEAVE'), 'EARLY_LEAVE should be allowed in leave deduction enum');
assert.ok(categoryEnumValues.includes('EARLY_LEAVE'), 'EARLY_LEAVE should be allowed in leave category enum');

console.log('EARLY_LEAVE deduction enum:', deductionEnumValues);
console.log('EARLY_LEAVE category enum:', categoryEnumValues);
