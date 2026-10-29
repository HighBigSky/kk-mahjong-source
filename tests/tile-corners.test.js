import test from 'node:test';
import assert from 'node:assert/strict';
import {tileCornerSides} from '../src/ui/tile-material.js';

test('tile frame keeps square local left corners independently of whole-tile rotation',()=>{
  for(const [width,height]of [[5,7],[7,5],[26.515625,37.140625]])assert.deepEqual(tileCornerSides(width,height),['hard','soft','soft','hard']);
});

test('internal SVG corner compensation aligns its rotated canvas with the tile frame',()=>{
  const expected=new Map([[0,['hard','soft','soft','hard']],[90,['soft','soft','hard','hard']],[-90,['hard','hard','soft','soft']],[180,['soft','hard','hard','soft']]]);
  for(const [angle,sides]of expected)for(const [width,height]of [[5,7],[7,5],[26.515625,37.140625]])assert.deepEqual(tileCornerSides(width,height,angle),sides);
});
