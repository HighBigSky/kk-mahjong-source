import test from 'node:test';
import assert from 'node:assert/strict';
import {tileCornerSides} from '../src/ui/tile-material.js';

test('hard corners stay on visual left under all four whole-tile rotations',()=>{
  const expected=new Map([[0,['hard','soft','soft','hard']],[90,['soft','soft','hard','hard']],[-90,['hard','hard','soft','soft']],[180,['soft','hard','hard','soft']]]);
  for(const [angle,sides]of expected)for(const [width,height]of [[5,7],[7,5],[26.515625,37.140625]])assert.deepEqual(tileCornerSides(width,height,angle),sides);
});
