'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{quote}=require('./calculator.cjs');
test('one kit includes shipping',()=>assert.deepEqual(quote(1),{quantity:1,coupon:'',subtotal:249,shipping:49,total:298,currency:'SEK'}));
test('three kits qualify for free shipping',()=>assert.equal(quote(3).total,747));
test('coupon and rounding are applied before shipping threshold',()=>assert.equal(quote(2,'LAB10').total,497.2));
test('coupon is case-sensitive',()=>assert.equal(quote(2,'lab10').total,547));
test('invalid quantities cannot produce a quote',()=>{for(const qty of [0,-1,13,1.5,NaN])assert.throws(()=>quote(qty),RangeError);});
test('coupon must be text',()=>assert.throws(()=>quote(1,null),TypeError));
