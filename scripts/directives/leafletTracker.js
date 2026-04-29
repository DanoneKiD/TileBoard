import L from 'leaflet';

/**
 * Renders a Leaflet + OpenStreetMap view for a device_tracker tile.
 *
 * Usage in tile.html:
 *   <div leaflet-tracker="item" entity="entity"></div>
 *
 * Reads:
 *   - item.zoomLevels[0]  → initial zoom (default 16)
 *   - item.refreshInterval → throttle marker updates (ms, default 0 = no throttle)
 *   - item.tileLayer → custom tile URL template (default OSM)
 *   - item.attribution → custom attribution (default OSM contributors)
 *   - entity.attributes.latitude / longitude → marker position
 *
 * Why this exists: Google Static Maps re-fetches an image on every state_changed,
 * which can saturate quotas for fast-updating GPS entities like robotic mowers.
 * Leaflet caches OSM tiles client-side and only repositions the marker on update.
 *
 * @ngInject
 * @type {angular.IDirectiveFactory}
 */
export default function () {
   return {
      restrict: 'A',
      replace: false,
      scope: {
         item: '=leafletTracker',
         entity: '=',
      },
      link: function ($scope, $el) {
         const config = $scope.item || {};
         const entity = $scope.entity;

         if (!entity || !entity.attributes) {
            return;
         }

         const initialLat = entity.attributes.latitude;
         const initialLng = entity.attributes.longitude;

         if (typeof initialLat !== 'number' || typeof initialLng !== 'number') {
            return;
         }

         const initialZoom = (config.zoomLevels && config.zoomLevels[0]) || 16;

         // Map type presets. Override fully via item.tileLayer + item.attribution.
         const MAP_PRESETS = {
            standard: {
               url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
               attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
               maxZoom: 19,
            },
            satellite: {
               url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
               attribution: 'Tiles © Esri',
               maxZoom: 19,
            },
            hybrid: {
               url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
               attribution: 'Tiles © Esri',
               maxZoom: 19,
               labelsUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            },
         };
         const mapType = config.mapType && MAP_PRESETS[config.mapType] ? config.mapType : 'standard';
         const preset = MAP_PRESETS[mapType];
         const tileUrl = config.tileLayer || preset.url;
         const attribution = config.attribution || preset.attribution;

         // Make element focusable for Leaflet rendering (it needs explicit dimensions)
         $el.css({ width: '100%', height: '100%' });

         const map = L.map($el[0], {
            zoomControl: false,
            attributionControl: true,
            dragging: false,
            touchZoom: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            tap: false,
         }).setView([initialLat, initialLng], initialZoom);

         L.tileLayer(tileUrl, {
            maxZoom: preset.maxZoom,
            attribution,
         }).addTo(map);

         // Hybrid mode overlays a transparent labels layer on top of the satellite layer.
         if (mapType === 'hybrid' && preset.labelsUrl) {
            L.tileLayer(preset.labelsUrl, {
               maxZoom: preset.maxZoom,
            }).addTo(map);
         }

         // Use a divIcon so we don't need to ship Leaflet's default marker images.
         const markerIcon = L.divIcon({
            className: '-leaflet-tracker-marker',
            html: '<div class="-leaflet-tracker-dot"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
         });
         const marker = L.marker([initialLat, initialLng], { icon: markerIcon }).addTo(map);

         // Leaflet sometimes mis-measures container size when initialized inside ng-if.
         // Force a recompute on next tick.
         setTimeout(function () {
            map.invalidateSize();
         }, 0);

         // Throttle marker updates so we don't hammer Leaflet on rapid GPS bursts.
         const refreshInterval = Number(config.refreshInterval) || 0;
         let pendingTimeout = null;
         let lastUpdate = 0;

         const applyUpdate = function (lat, lng) {
            marker.setLatLng([lat, lng]);
            map.panTo([lat, lng], { animate: false });
            lastUpdate = Date.now();
         };

         const scheduleUpdate = function (lat, lng) {
            if (!refreshInterval) {
               applyUpdate(lat, lng);
               return;
            }
            const now = Date.now();
            const elapsed = now - lastUpdate;
            if (elapsed >= refreshInterval) {
               applyUpdate(lat, lng);
               return;
            }
            if (pendingTimeout) {
               clearTimeout(pendingTimeout);
            }
            pendingTimeout = setTimeout(function () {
               pendingTimeout = null;
               applyUpdate(lat, lng);
            }, refreshInterval - elapsed);
         };

         // React to coord changes via deep $watch.
         const unwatch = $scope.$watch(
            function () {
               if (!$scope.entity || !$scope.entity.attributes) {
                  return null;
               }
               return [
                  $scope.entity.attributes.latitude,
                  $scope.entity.attributes.longitude,
               ];
            },
            function (newCoords, oldCoords) {
               if (!newCoords) {
                  return;
               }
               if (typeof newCoords[0] !== 'number' || typeof newCoords[1] !== 'number') {
                  return;
               }
               if (oldCoords && newCoords[0] === oldCoords[0] && newCoords[1] === oldCoords[1]) {
                  return;
               }
               scheduleUpdate(newCoords[0], newCoords[1]);
            },
            true,
         );

         $scope.$on('$destroy', function () {
            if (pendingTimeout) {
               clearTimeout(pendingTimeout);
            }
            unwatch();
            map.remove();
         });
      },
   };
}
