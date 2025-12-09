/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef, useState } from "react";
import L, { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { io, Socket } from "socket.io-client";
import "./App.css";

// Import leaflet marker images
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Fix for default marker icons in Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface LocationUpdate {
  lat: number;
  lng: number;
  speed?: number;
  bearing?: number;
}

const RiderMap: React.FC = () => {
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const carIconRef = useRef<L.Icon | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);
  const [connectionStatus, setConnectionStatus] = useState<string>("Connecting...");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [targetLocation, setTargetLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const mountedRef = useRef(true);

  // Initialize car icon
  useEffect(() => {
    carIconRef.current = L.icon({
      iconUrl: new URL("./assets/motor.png", import.meta.url).href,
      iconSize: [100, 100],
      iconAnchor: [50, 50], // Center anchor for rotation
      popupAnchor: [0, -50],
    });
  }, []);

  // Smooth animation function
  const animateMarker = (startLat: number, startLng: number, endLat: number, endLng: number, duration: number = 1000) => {
    if (!markerRef.current || !mountedRef.current) return;

    const startTime = Date.now();
    const endTime = startTime + duration;

    const animateStep = () => {
      if (!markerRef.current || !mountedRef.current) {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        return;
      }

      const now = Date.now();
      const progress = Math.min((now - startTime) / duration, 1);

      // Easing function for smooth acceleration/deceleration
      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
      const easedProgress = easeOutCubic(progress);

      // Calculate intermediate position
      const currentLat = startLat + (endLat - startLat) * easedProgress;
      const currentLng = startLng + (endLng - startLng) * easedProgress;

      // Update marker position
      markerRef.current.setLatLng([currentLat, currentLng]);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animateStep);
      } else {
        // Animation complete, update to exact position
        markerRef.current.setLatLng([endLat, endLng]);
        setCurrentLocation({ lat: endLat, lng: endLng });
      }
    };

    // Cancel any existing animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = requestAnimationFrame(animateStep);
  };

  useEffect(() => {
    mountedRef.current = true;

    const initializeMap = () => {
      if (!mapContainerRef.current || mapRef.current) return;

      try {
        mapRef.current = L.map(mapContainerRef.current, {
          zoomControl: false, // Disable default zoom controls
          attributionControl: false,
          zoomSnap: 0.1,
          zoomDelta: 0.5,
          wheelPxPerZoomLevel: 60,
          inertia: true,
          inertiaDeceleration: 600,
          worldCopyJump: false,
          preferCanvas: true,
          fadeAnimation: true,
          markerZoomAnimation: true,
        }).setView([23.8, 90.4], 13);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
          detectRetina: true,
        }).addTo(mapRef.current);

        // Enable smooth interactions
        mapRef.current.scrollWheelZoom.enable();
        mapRef.current.touchZoom.enable();
        mapRef.current.doubleClickZoom.enable();

        // Add initial marker
        if (carIconRef.current) {
          markerRef.current = L.marker([23.8, 90.4], {
            icon: carIconRef.current,
            riseOnHover: true,
            zIndexOffset: 1000,
            draggable: false,
            autoPan: true,
            autoPanPadding: [50, 50],
          }).addTo(mapRef.current);

          markerRef.current
            .bindPopup("<b>Rider Location</b><br>Waiting for updates...")
            .openPopup();
        }

        // Force map resize
        setTimeout(() => {
          mapRef.current?.invalidateSize();
        }, 100);
      } catch (error) {
        console.error("Error initializing map:", error);
      }
    };

    initializeMap();

    // Connect to Socket.IO
    try {
      socketRef.current = io("http://localhost:3000/rider", {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      const socket = socketRef.current;

      socket.on("connect", () => {
        if (mountedRef.current) {
          setConnectionStatus("Connected");
          console.log("Socket connected:", socket.id);
        }
      });

      socket.on("location-update", (data: LocationUpdate) => {
        if (!mountedRef.current) return;

        const { lat, lng, bearing } = data;
        if (!lat || !lng) return;

        const marker = markerRef.current;
        const map = mapRef.current;

        if (!marker || !map) return;

        try {
          // Get current marker position
          const currentPos = marker.getLatLng();
          const startLat = currentPos.lat;
          const startLng = currentPos.lng;

          // Calculate animation duration based on distance and speed
          const distance = map.distance([startLat, startLng], [lat, lng]);
          const duration = Math.min(Math.max(distance / 10, 500), 2000); // 500ms to 2000ms

          // Animate marker movement
          animateMarker(startLat, startLng, lat, lng, duration);

          // Update popup with current location
          marker.bindPopup(
            `<b>Rider Location</b><br>
             Lat: ${lat.toFixed(6)}<br>
             Lng: ${lng.toFixed(6)}<br>
             ${data.speed ? `Speed: ${data.speed.toFixed(1)} km/h` : ""}
             ${bearing ? `<br>Bearing: ${bearing.toFixed(0)}°` : ""}`
          );

          // Smoothly pan map to follow marker (with some delay)
          setTimeout(() => {
            if (mapRef.current && mountedRef.current) {
              mapRef.current.panTo([lat, lng], {
                animate: true,
                duration: duration / 1000, // Convert to seconds
                easeLinearity: 0.25,
              });
            }
          }, duration * 0.3); // Start panning after 30% of marker animation

          // Update target location for UI
          setTargetLocation({ lat, lng });
          setLastUpdate(new Date());

          // Rate limiting - prevent too frequent updates
          const now = Date.now();
          if (now - lastUpdateTimeRef.current > 100) { // Minimum 100ms between updates
            lastUpdateTimeRef.current = now;
          }
        } catch (err) {
          console.error("Leaflet marker update error:", err);
        }
      });

      socket.on("disconnect", () => {
        if (mountedRef.current) {
          setConnectionStatus("Disconnected");
          console.log("Socket disconnected");
        }
      });

      socket.on("connect_error", (err: Error & { message: string }) => {
        if (mountedRef.current) {
          setConnectionStatus("Connection Error");
          console.error("Socket error:", err.message);
        }
      });

      socket.on("reconnecting", (attemptNumber: number) => {
        if (mountedRef.current) {
          setConnectionStatus(`Reconnecting (${attemptNumber})...`);
        }
      });
    } catch (error) {
      console.error("Socket initialization error:", error);
    }

    // Handle window resize
    const handleResize = () => {
      if (mapRef.current) {
        setTimeout(() => {
          mapRef.current?.invalidateSize();
        }, 100);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      mountedRef.current = false;
      
      // Cancel any ongoing animation
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      window.removeEventListener("resize", handleResize);

      // Disconnect socket
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      // Cleanup map
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      // Cleanup marker
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, []);

  const formatTime = (date: Date | null) => {
    if (!date) return "Never";
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  // Handle manual center on rider
  const centerOnRider = () => {
    if (mapRef.current && currentLocation) {
      mapRef.current.flyTo([currentLocation.lat, currentLocation.lng], 15, {
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }
  };

  return (
    <div className="rider-map-container">
      {/* Map */}
      <div ref={mapContainerRef} className="map" />

      {/* Status Overlay */}
      <div className="status-overlay">
        <div className="status-card">
          <h3 className="status-title">Live Rider Tracking</h3>

          <div className="status-info">
            <div className="status-item">
              <span className="status-label">Status:</span>
              <span
                className={`status-value ${
                  connectionStatus === "Connected"
                    ? "connected"
                    : "disconnected"
                }`}
              >
                {connectionStatus}
              </span>
            </div>

            {currentLocation && (
              <div className="status-item">
                <span className="status-label">Current:</span>
                <span className="status-value">
                  {currentLocation.lat.toFixed(6)},{" "}
                  {currentLocation.lng.toFixed(6)}
                </span>
              </div>
            )}

            {targetLocation && (
              <div className="status-item">
                <span className="status-label">Target:</span>
                <span className="status-value">
                  {targetLocation.lat.toFixed(6)},{" "}
                  {targetLocation.lng.toFixed(6)}
                </span>
              </div>
            )}

            <div className="status-item">
              <span className="status-label">Last Update:</span>
              <span className="status-value">{formatTime(lastUpdate)}</span>
            </div>
          </div>

          <div className="button-group">
            <button className="action-btn" onClick={centerOnRider} title="Center on Rider">
              <span>📍</span> Center
            </button>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="controls-container">
        <div className="zoom-controls">
          <button
            className="control-btn"
            onClick={() => mapRef.current?.zoomIn(0.5)}
            title="Zoom In"
          >
            +
          </button>
          <button
            className="control-btn"
            onClick={() => mapRef.current?.zoomOut(0.5)}
            title="Zoom Out"
          >
            −
          </button>
        </div>
        <button
          className="control-btn reset-btn"
          onClick={() => mapRef.current?.setView([23.8, 90.4], 13)}
          title="Reset View"
        >
          ↻
        </button>
      </div>
    </div>
  );
};

export default RiderMap;