import { describe, expect, it } from 'vitest';
import { coordsFromText, isShortMapLink, toPlace } from '../src/lib/geo';

describe('coordsFromText', () => {
  it('reads typed coordinates', () => {
    expect(coordsFromText('23.7937, 90.4066')).toEqual({ lat: 23.7937, lng: 90.4066 });
    expect(coordsFromText(' 23.7937 90.4066 ')).toEqual({ lat: 23.7937, lng: 90.4066 });
    expect(coordsFromText('-33.86,151.2')).toEqual({ lat: -33.86, lng: 151.2 });
  });

  it("prefers a Google place's own pin over the map centre", () => {
    const link = 'https://www.google.com/maps/place/Arena/@23.79,90.41,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d23.7937!4d90.4066';
    expect(coordsFromText(link)).toEqual({ lat: 23.7937, lng: 90.4066 });
  });

  it('reads query and centre links', () => {
    expect(coordsFromText('https://maps.google.com/?q=23.8103,90.4125')).toEqual({ lat: 23.8103, lng: 90.4125 });
    expect(coordsFromText('https://www.google.com/maps/search/?api=1&query=23.8103%2C90.4125')).toEqual({ lat: 23.8103, lng: 90.4125 });
    expect(coordsFromText('https://maps.apple.com/?ll=23.8,90.4&q=Pin')).toEqual({ lat: 23.8, lng: 90.4 });
    expect(coordsFromText('https://www.google.com/maps/@23.75,90.39,15z')).toEqual({ lat: 23.75, lng: 90.39 });
  });

  it('refuses text without coordinates or with impossible ones', () => {
    expect(coordsFromText('Gulshan 2, Dhaka')).toBeNull();
    expect(coordsFromText('https://maps.app.goo.gl/AbCdEf')).toBeNull();
    expect(coordsFromText('95, 90')).toBeNull();
    expect(coordsFromText('2024 1212')).toBeNull();
  });
});

describe('isShortMapLink', () => {
  it('spots Google share links only', () => {
    expect(isShortMapLink('https://maps.app.goo.gl/AbCdEf')).toBe(true);
    expect(isShortMapLink('https://goo.gl/maps/xyz')).toBe(true);
    expect(isShortMapLink('http://maps.app.goo.gl/AbCdEf')).toBe(false);
    expect(isShortMapLink('https://www.google.com/maps/@1,2,3z')).toBe(false);
    expect(isShortMapLink('Gulshan')).toBe(false);
  });
});

describe('toPlace', () => {
  it('turns a Nominatim hit into a point, bounds and town', () => {
    const p = toPlace({
      display_name: 'Gulshan 2, Gulshan, Dhaka, Bangladesh',
      lat: '23.7937',
      lon: '90.4146',
      boundingbox: ['23.78', '23.80', '90.40', '90.42'],
      address: { suburb: 'Gulshan', city: 'Dhaka' },
    });
    expect(p).toEqual({
      label: 'Gulshan 2, Gulshan, Dhaka, Bangladesh',
      lat: 23.7937,
      lng: 90.4146,
      bounds: [23.78, 90.4, 23.8, 90.42],
      city: 'Dhaka',
    });
  });
});
