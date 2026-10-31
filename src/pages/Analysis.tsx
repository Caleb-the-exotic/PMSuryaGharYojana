import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Crosshair, Upload, Lock, AlertTriangle, CheckCircle2, XCircle,
  RotateCcw, Download, ChevronLeft, ChevronRight, Radar, MapPin,
  Cpu, Zap, BarChart3, Activity, Eye, Save, Compass, Home, Shield
} from "lucide-react";
import { Link } from "react-router-dom";

import ProtectedFeature from "@/components/ProtectedFeature";
import { useAuth } from "@/contexts/AuthContext";
import { api, type AnalysisResult } from "@/lib/api";

const ConfidenceCircle = ({ value }: { value: number }) => {
  const clamped = Math.max(0, Math.min(100, value));
  const circumference = 2 * Math.PI * 40;
  const filled = (clamped / 100) * circumference;

  return (
    <div className="relative w-24 h-24">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r="40" fill="none" stroke="hsl(220,30%,18%)" strokeWidth="4" />
        <motion.circle
          cx="48" cy="48" r="40" fill="none"
          stroke="hsl(168,100%,48%)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - filled }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          style={{ filter: "drop-shadow(0 0 6px hsl(168,100%,48%,0.5))" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-display text-lg font-bold text-foreground">{clamped.toFixed(1)}%</span>
      </div>
    </div>
  );
};

interface ScanResults {
  detected: boolean;
  panelCount: number;
  confidence: number;
  powerEstimateKw: number;
  areaEstimateSqm: number;
  sampleId: string;
  qcNotes: string[];
  rawJson: Record<string, any>;
  savedId?: string;
  bufferRadius?: string;
  annotatedImage?: string;
  predictions?: any[];
}

const Analysis = () => {
  const { isAuthenticated, user, showAuthModal } = useAuth();
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [address, setAddress] = useState("");
  const [bufferRadius, setBufferRadius] = useState<"1200" | "2400">("1200");

  const [scanStarted, setScanStarted] = useState(false);
  const [isImmobilized, setIsImmobilized] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [scanProgress, setScanProgress] = useState(0);

  const [results, setResults] = useState<ScanResults | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  // ArcGIS 2D Map Refs
  const mapViewRef = useRef<any>(null);
  const mapElementRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // ArcGIS 3D SceneView (ESRI Satellite Map) Refs
  const sceneViewRef = useRef<any>(null);
  const sceneElementRef = useRef<HTMLDivElement>(null);
  const [altitude, setAltitude] = useState(0);
  const [tilt, setTilt] = useState(45);
  const [activeTab, setActiveTab] = useState<'primary' | 'detailed' | 'logs'>('primary');
  const [displayMode, setDisplayMode] = useState<'3d' | 'annotated'>('3d');

  // Initialize ArcGIS 2D MapView
  useEffect(() => {
    if (!window.require || !mapElementRef.current) return;

    window.require([
      "esri/Map",
      "esri/views/MapView",
      "esri/Graphic",
      "esri/layers/GraphicsLayer",
      "esri/geometry/Point",
      "esri/rest/locator",
      "esri/widgets/Search"
    ], (Map: any, MapView: any, Graphic: any, GraphicsLayer: any, Point: any, locator: any, Search: any) => {
      const graphicsLayer = new GraphicsLayer();
      const map = new Map({
        basemap: "streets-navigation-vector"
      });
      map.add(graphicsLayer);

      const initialLon = parseFloat(lon) || 78.9629;
      const initialLat = parseFloat(lat) || 20.5937;
      const initialZoom = (lat && lon) ? 15 : 4;

      const view = new MapView({
        container: mapElementRef.current,
        map: map,
        zoom: initialZoom,
        center: [initialLon, initialLat],
        constraints: {
          geometry: {
            type: "extent",
            xmin: 68.1,
            ymin: 6.5,
            xmax: 97.4,
            ymax: 35.5,
            spatialReference: { wkid: 4326 }
          },
          minZoom: 4
        },
        ui: { components: ["attribution", "zoom"] }
      });

      let searchWidget: any = null;

      if (searchContainerRef.current) {
        searchContainerRef.current.innerHTML = '';

        searchWidget = new Search({
          view: view,
          container: searchContainerRef.current,
          popupEnabled: false,
          resultGraphicEnabled: false,
          maxResults: 4,
          maxSuggestions: 4
        });

        searchWidget.on("select-result", (event: any) => {
          const geom = event.result.feature.geometry;
          updateLocation(geom.longitude, geom.latitude, true);
        });
      }

      const updateLocation = (longitude: number, latitude: number, updateInput = false) => {
        if (isNaN(latitude) || isNaN(longitude)) return;
        const pLat = Number(latitude.toFixed(6));
        const pLon = Number(longitude.toFixed(6));

        if (updateInput) {
          setLat(pLat.toString());
          setLon(pLon.toString());
        }

        graphicsLayer.removeAll();
        const point = new Point({ longitude: pLon, latitude: pLat });
        graphicsLayer.add(new Graphic({
          geometry: point,
          symbol: {
            type: "simple-marker",
            path: "M16,0C7.164,0,0,7.164,0,16c0,13.682,14.659,31.026,15.341,31.815C15.511,48.01,15.75,48.113,16,48.113s0.489-0.103,0.659-0.298C17.341,47.026,32,29.682,32,16C32,7.164,24.836,0,16,0z M16,24c-4.418,0-8-3.582-8-8s3.582-8,8-8s8,3.582,8,8S20.418,24,16,24z",
            color: "#ffb703",
            outline: { color: "transparent", width: 0 },
            size: "28px",
            yoffset: "14px"
          }
        }));

        graphicsLayer.effect = "drop-shadow(3px 5px 6px rgba(0, 0, 0, 0.3))";

        locator.locationToAddress("https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer", {
          location: point
        }).then((res: any) => setAddress(res.address || "Unknown Location")).catch(() => {});
      };

      view.on("click", (event: any) => {
        const point = view.toMap(event.screenPoint);
        if (point) updateLocation(point.longitude, point.latitude, true);
      });

      mapViewRef.current = { view, updateLocation, graphicsLayer, Point, Graphic, searchWidget };

      if (lat && lon) {
        updateLocation(parseFloat(lon), parseFloat(lat));
      }
    });

    return () => {
      if (mapViewRef.current?.searchWidget) mapViewRef.current.searchWidget.destroy();
      if (mapViewRef.current?.view) mapViewRef.current.view.destroy();
    };
  }, []);

  // Sync manual input to 2D map
  const handleInputChange = (type: 'lat' | 'lon', val: string) => {
    if (type === 'lat') setLat(val);
    else setLon(val);

    if (mapViewRef.current) {
      const nLat = type === 'lat' ? parseFloat(val) : parseFloat(lat);
      const nLon = type === 'lon' ? parseFloat(val) : parseFloat(lon);
      if (!isNaN(nLat) && !isNaN(nLon)) {
        mapViewRef.current.updateLocation(nLon, nLat);
        mapViewRef.current.view.goTo({ center: [nLon, nLat] });
      }
    }
  };

  // Initialize ESRI 3D SceneView when scan starts
  useEffect(() => {
    if (!scanStarted || !sceneElementRef.current || !window.require) return;

    let isSubscribed = true;
    const container = sceneElementRef.current;
    container.innerHTML = "";

    window.require([
      "esri/Map",
      "esri/views/SceneView",
      "esri/Graphic",
      "esri/layers/GraphicsLayer",
      "esri/geometry/Point"
    ], (Map: any, SceneView: any, Graphic: any, GraphicsLayer: any, Point: any) => {
      if (!isSubscribed || !container) return;

      const targetLat = parseFloat(lat);
      const targetLon = parseFloat(lon);

      const graphicsLayer = new GraphicsLayer();
      const map = new Map({
        basemap: "satellite", // ESRI World Imagery Photorealistic Satellite Map
        ground: "world-elevation" // 3D Elevation Terrain
      });
      map.add(graphicsLayer);

      // Buffer radius camera altitude:
      // 1,200 ft (~365m) -> camera z ~ 420m
      // 2,400 ft (~730m) -> camera z ~ 850m
      const cameraAltitude = bufferRadius === "2400" ? 850 : 420;

      const sceneView = new SceneView({
        container: container,
        map: map,
        camera: {
          position: {
            latitude: targetLat,
            longitude: targetLon,
            z: cameraAltitude
          },
          tilt: 45,
          heading: 0
        },
        qualityProfile: "high",
        environment: {
          atmosphere: { quality: "high" },
          lighting: { directShadowsEnabled: true }
        },
        ui: { components: ["attribution"] }
      });

      // Marker at target location
      const point = new Point({ longitude: targetLon, latitude: targetLat });
      graphicsLayer.add(new Graphic({
        geometry: point,
        symbol: {
          type: "simple-marker",
          path: "M16,0C7.164,0,0,7.164,0,16c0,13.682,14.659,31.026,15.341,31.815C15.511,48.01,15.75,48.113,16,48.113s0.489-0.103,0.659-0.298C17.341,47.026,32,29.682,32,16C32,7.164,24.836,0,16,0z M16,24c-4.418,0-8-3.582-8-8s3.582-8,8-8s8,3.582,8,8S20.418,24,16,24z",
          color: "#00f7ff",
          size: "26px",
          yoffset: "13px"
        }
      }));

      sceneViewRef.current = sceneView;
      setAltitude(cameraAltitude);
      setTilt(45);

      sceneView.watch("camera", (cam: any) => {
        if (cam?.position?.z !== undefined) setAltitude(Math.round(cam.position.z));
        if (cam?.tilt !== undefined) setTilt(Math.round(cam.tilt));
      });

      // Sequence: Wait for 3D tiles to load -> Immobilize container -> Take screenshot -> Run weights inference
      sceneView.when(async () => {
        if (!isSubscribed) return;

        setScanStatus("Acquiring 3D ESRI satellite imagery...");
        setScanProgress(30);

        // Allow 3D tiles to settle and sharpen (immobilized container)
        await new Promise((r) => setTimeout(r, 1400));
        if (!isSubscribed) return;

        setScanStatus(`Stabilizing ${bufferRadius === "1200" ? "1,200 ft" : "2,400 ft"} viewport buffer...`);
        setScanProgress(60);
        await new Promise((r) => setTimeout(r, 1600));
        if (!isSubscribed) return;

        setScanStatus("Capturing viewport screenshot...");
        setScanProgress(80);

        try {
          // Take screenshot directly within container
          const screenshot = await sceneView.takeScreenshot({ format: "jpg", quality: 95 });
          if (!isSubscribed) return;

          setScanStatus("Processing with YOLOv11 ONNX weights...");
          setScanProgress(90);

          // Send captured screenshot to backend for processing with weights
          const apiResult = await api.analyzeLocation({
            latitude: targetLat,
            longitude: targetLon,
            image_base64: screenshot.dataUrl,
            buffer_radius: bufferRadius,
          });

          if (!isSubscribed) return;

          setScanProgress(100);
          setScanStatus("Inference complete.");

          setResults({
            detected: apiResult.panel_detected,
            panelCount: apiResult.panel_count,
            confidence: apiResult.confidence_score,
            powerEstimateKw: apiResult.estimated_capacity,
            areaEstimateSqm: apiResult.pv_area,
            sampleId: apiResult.sample_id,
            qcNotes: apiResult.qc_notes || [],
            rawJson: apiResult.raw_json,
            savedId: apiResult.id,
            bufferRadius: bufferRadius === "1200" ? "1,200 ft" : "2,400 ft",
            annotatedImage: apiResult.annotated_image,
            predictions: apiResult.predictions,
          });

          if (apiResult.annotated_image) {
            setDisplayMode('annotated');
          }

          if (apiResult.user_id) setSaved(true);
        } catch (err: any) {
          console.error("Inference processing error:", err);
          showError("Model inference error: " + (err.message || "Failed to process image"));

          setResults({
            detected: false,
            panelCount: 0,
            confidence: 0,
            powerEstimateKw: 0,
            areaEstimateSqm: 0,
            sampleId: "ERR-" + Math.floor(1000 + Math.random() * 9000),
            qcNotes: [
              "Model inference encountered an issue: " + (err.message || "Network / processing error"),
              `Target: Lat ${targetLat.toFixed(4)}, Lon ${targetLon.toFixed(4)}`,
              `Buffer radius: ${bufferRadius === "1200" ? "1,200 ft" : "2,400 ft"}`
            ],
            rawJson: { error: err.message || "Inference failed" },
            bufferRadius: bufferRadius === "1200" ? "1,200 ft" : "2,400 ft"
          });
        } finally {
          // Release immobilization so user can freely interact with the 3D map
          if (isSubscribed) {
            setIsImmobilized(false);
          }
        }
      }).catch((e: any) => {
        console.error("SceneView loading error:", e);
        if (isSubscribed) {
          setIsImmobilized(false);
          showError("3D Map rendering error: " + (e?.message || e));
        }
      });
    });

    return () => {
      isSubscribed = false;
      if (sceneViewRef.current) {
        try {
          sceneViewRef.current.destroy();
        } catch (e) {}
        sceneViewRef.current = null;
      }
    };
  }, [scanStarted, bufferRadius, lat, lon]);

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(""), 5000);
  };

  const executeScan = () => {
    if (!lat || !lon || isNaN(parseFloat(lat)) || isNaN(parseFloat(lon))) {
      showError("Please search or drop a pin on the map to define target coordinates.");
      return;
    }
    setError("");
    setResults(null);
    setSaved(false);
    setIsImmobilized(true);
    setScanProgress(10);
    setScanStatus("Initializing ESRI 3D Satellite Feed...");
    setScanStarted(true);
  };

  const saveToDb = async () => {
    if (!isAuthenticated) {
      showAuthModal("Please login to save analysis results to your account.");
      return;
    }
    if (!results) return;
    setSaving(true);
    try {
      const saveRes = await api.saveAnalysis(user?.id || "", results);
      setSaved(true);
      setResults((prev) => prev ? { ...prev, savedId: saveRes.history_record.id } : prev);
    } catch (err: any) {
      showError("Failed to save: " + (err.message || "Unknown error"));
    } finally {
      setSaving(false);
    }
  };

  const resetScan = () => {
    setResults(null);
    setScanStarted(false);
    setIsImmobilized(false);
    setActiveTab('primary');
    setDisplayMode('3d');
    setDetailsOpen(false);
    setError("");
    setSaved(false);
    if (sceneViewRef.current) {
      try {
        sceneViewRef.current.destroy();
      } catch (e) {}
      sceneViewRef.current = null;
    }
  };

  const downloadJson = () => {
    if (!isAuthenticated) {
      showAuthModal("Please login to download JSON analysis logs.");
      return;
    }
    if (!results) return;
    const blob = new Blob([JSON.stringify(results.rawJson, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scan-${results.sampleId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isAuthenticated) {
      showAuthModal("Please login to use CSV batch processing.");
      return;
    }
    setBatchProgress("Uploading...");
    try {
      const result = await api.uploadCsv(file);
      setBatchProgress(`Job ${result.job_id}: ${result.status}`);
    } catch (err: any) {
      setBatchProgress(null);
      showError("CSV upload failed: " + (err.message || "Unknown error"));
    }
  };

  const tabsArray = ['primary', 'detailed', 'logs'] as const;
  const tabNames = {
    primary: 'Primary Analysis',
    detailed: 'Detailed Metrics',
    logs: 'Quality Control Notes'
  };

  const handleNextTab = () => {
    const idx = tabsArray.indexOf(activeTab);
    setActiveTab(tabsArray[(idx + 1) % tabsArray.length]);
  };

  const handlePrevTab = () => {
    const idx = tabsArray.indexOf(activeTab);
    setActiveTab(tabsArray[(idx - 1 + tabsArray.length) % tabsArray.length]);
  };

  return (
    <div className="min-h-screen">
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
            className="fixed top-24 right-6 z-[100] flex items-center shadow-lg gap-3 text-destructive text-sm font-medium bg-destructive/10 border border-destructive/20 backdrop-blur-md rounded-xl px-4 py-3 max-w-sm leading-relaxed"
          >
            <AlertTriangle className="w-5 h-5" />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .esri-search {
          box-shadow: none !important;
          background: transparent !important;
          width: 100% !important;
          max-width: 600px !important;
        }
        .esri-search__container {
          background: rgba(13, 17, 23, 0.8) !important;
          border: 1px solid rgba(0, 247, 255, 0.2) !important;
          border-radius: 8px !important;
          backdrop-filter: blur(8px) !important;
        }
        .esri-search__input {
          background: transparent !important;
          color: #fff !important;
          font-family: inherit !important;
        }
        .esri-search__input::placeholder {
          color: rgba(255, 255, 255, 0.5) !important;
        }
        .esri-search__submit-button, .esri-search__clear-button {
          background: transparent !important;
          color: #00f7ff !important;
        }
        .esri-menu {
          background-color: rgba(13, 17, 23, 0.95) !important;
          border: 1px solid rgba(0, 247, 255, 0.2) !important;
          border-radius: 8px !important;
        }
        .esri-menu__list-item {
          color: rgba(255, 255, 255, 0.8) !important;
        }
        .esri-menu__list-item:hover, .esri-menu__list-item--active {
          background-color: rgba(0, 247, 255, 0.1) !important;
          color: #00f7ff !important;
        }
        .esri-view-surface:focus {
          outline: none !important;
        }
      `}</style>

      <div className="container mx-auto px-4 md:px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-3">
            <Radar className="inline w-8 h-8 text-primary mr-3 -mt-1" />
            AI-Powered Solar Analysis
          </h1>
        </motion.div>

        {/* ── 2D Map Selection Screen ────────────────────────────────────────────── */}
        <div className={scanStarted ? "hidden" : "block"}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card rounded-2xl p-6 h-[460px] overflow-y-auto flex flex-col justify-between"
            >
              <div>
                <h3 className="font-display font-bold text-foreground mb-5 flex items-center gap-2">
                  <Crosshair className="w-5 h-5 text-primary" />
                  Target Parameters
                </h3>

                {/* Target ID */}
                <div className="mb-4">
                  <label className="font-mono-tactical text-[10px] text-muted-foreground mb-1 block">
                    TARGET ID
                  </label>
                  <div className="glass-card rounded-lg px-3 py-2 text-sm text-muted-foreground font-mono">
                    {isAuthenticated ? "SRY-2026-AUTO" : "DEMO-SCAN"}
                  </div>
                </div>

                {/* Latitude and Longitude in a single row */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="font-mono-tactical text-[10px] text-muted-foreground mb-1 block">
                      LATITUDE
                    </label>
                    <input
                      type="text"
                      value={lat}
                      placeholder="28.6139"
                      onChange={(e) => handleInputChange('lat', e.target.value)}
                      className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="font-mono-tactical text-[10px] text-muted-foreground mb-1 block">
                      LONGITUDE
                    </label>
                    <input
                      type="text"
                      value={lon}
                      placeholder="77.2090"
                      onChange={(e) => handleInputChange('lon', e.target.value)}
                      className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </div>

                {/* Buffer Radius (Two Options: 1,200 ft and 2,400 ft) */}
                <div className="mb-4">
                  <label className="font-mono-tactical text-[10px] text-muted-foreground mb-1 block">
                    BUFFER RADIUS
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setBufferRadius("1200")}
                      className={`px-3 py-2 rounded-lg text-xs font-mono transition-all border ${
                        bufferRadius === "1200"
                          ? "bg-primary/20 border-primary text-primary font-bold shadow-[0_0_10px_rgba(0,247,255,0.2)]"
                          : "bg-muted/30 border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                      }`}
                    >
                      1,200 ft
                    </button>
                    <button
                      type="button"
                      onClick={() => setBufferRadius("2400")}
                      className={`px-3 py-2 rounded-lg text-xs font-mono transition-all border ${
                        bufferRadius === "2400"
                          ? "bg-primary/20 border-primary text-primary font-bold shadow-[0_0_10px_rgba(0,247,255,0.2)]"
                          : "bg-muted/30 border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                      }`}
                    >
                      2,400 ft
                    </button>
                  </div>
                </div>

                {/* Batch Upload */}
                <div className="mb-4">
                  <label className="font-mono-tactical text-[10px] text-muted-foreground mb-1 block">
                    BATCH UPLOAD
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleCsvUpload}
                  />
                  {isAuthenticated ? (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="glass-card rounded-lg px-3 py-2 flex items-center justify-center gap-2 text-primary/70 hover:text-primary transition-colors w-full"
                    >
                      <Upload className="w-4 h-4" />
                      <span className="text-xs font-mono">{batchProgress || "Upload CSV"}</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => showAuthModal("Please login to use CSV batch processing.")}
                      className="glass-card rounded-lg px-3 py-2 flex items-center justify-center gap-2 text-muted-foreground/50 w-full"
                    >
                      <Lock className="w-4 h-4" />
                      <span className="text-xs font-mono">CSV upload (locked)</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Execute Scan Button */}
              <button
                onClick={executeScan}
                className="btn-cyan w-full flex items-center justify-center gap-2 py-3"
              >
                <Radar className="w-5 h-5" />
                EXECUTE SCAN
              </button>
            </motion.div>

            {/* 2D Map Container (Completely Unaffected) */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="lg:col-span-2 glass-card rounded-2xl relative h-[460px]"
            >
              <div className="absolute top-4 right-4 z-[60] glass-card rounded-lg px-3 py-1.5 flex items-center gap-2 bg-background/50 backdrop-blur">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                </span>
                <span className="font-mono-tactical text-[10px] text-foreground uppercase">ArcGIS Interactive Feed</span>
              </div>

              <div ref={mapElementRef} className="absolute inset-0 z-0 bg-muted/20 rounded-2xl overflow-hidden" />

              <div className="absolute bottom-0 left-0 right-0 z-[50] flex gap-px border-t border-border rounded-b-2xl">
                <div className="flex-1 bg-background/80 backdrop-blur-sm px-4 py-2 flex items-center justify-center min-h-[60px]">
                  <div ref={searchContainerRef} className="w-full flex justify-center relative z-[60]" />
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        {/* ── 3D Map & Real Model Results Screen ─────────────────────────────────── */}
        <AnimatePresence>
          {scanStarted && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
                {/* Left Panel: Neural Inference Output */}
                <div className="glass-card rounded-2xl p-6 flex flex-col h-[480px]">
                  <h3 className="font-display font-bold text-foreground mb-4 flex items-center gap-2">
                    <Cpu className="w-5 h-5 text-primary" />
                    Neural Inference Output
                  </h3>

                  {/* Navigation Arrows for Category */}
                  <div className="flex justify-between items-center bg-muted/30 rounded-lg p-2 mb-4 border border-border/50">
                    <button onClick={handlePrevTab} className="p-1.5 hover:bg-background rounded-md text-muted-foreground hover:text-primary transition-colors">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="italic font-bold text-sm text-foreground capitalize tracking-wide">{tabNames[activeTab]}</span>
                    <button onClick={handleNextTab} className="p-1.5 hover:bg-background rounded-md text-muted-foreground hover:text-primary transition-colors">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Tab Content */}
                  <div className="flex-1 flex flex-col justify-center">
                    {!results ? (
                      /* Live Progress Telemetry while 3D container is immobilized and model is running */
                      <div className="flex flex-col items-center justify-center text-center p-6 space-y-4">
                        <div className="relative w-20 h-20">
                          <div className="absolute inset-0 rounded-full border border-primary/20 animate-pulse" />
                          <div className="absolute inset-2 rounded-full border-t border-primary animate-spin" />
                          <Radar className="absolute inset-0 m-auto w-8 h-8 text-primary animate-pulse" />
                        </div>
                        <div>
                          <div className="font-display text-2xl font-bold text-foreground mb-1">
                            {scanProgress}%
                          </div>
                          <div className="font-mono-tactical text-xs text-primary animate-pulse">
                            {scanStatus}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground mt-2">
                            Buffer: {bufferRadius === "1200" ? "1,200 ft" : "2,400 ft"} | Lat: {parseFloat(lat).toFixed(4)}, Lon: {parseFloat(lon).toFixed(4)}
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Real model inference output from weights.onnx */
                      <AnimatePresence mode="wait">
                        {activeTab === 'primary' ? (
                          <motion.div
                            key="primary"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="flex flex-col gap-4"
                          >
                            <div className="glass-card rounded-xl p-4 w-full">
                              <span className="font-mono-tactical text-[9px] text-muted-foreground block mb-2">Detection Signature</span>
                              <div className="flex items-center gap-2">
                                {results.detected ? (
                                  <>
                                    <CheckCircle2 className="w-6 h-6 text-success" />
                                    <span className="font-display text-lg font-bold text-success uppercase">Positive (Solar Detected)</span>
                                  </>
                                ) : (
                                  <>
                                    <XCircle className="w-6 h-6 text-destructive" />
                                    <span className="font-display text-lg font-bold text-destructive uppercase">Negative (No Panels Detected)</span>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="glass-card rounded-xl p-4 flex flex-col justify-center">
                                <span className="font-mono-tactical text-[9px] text-muted-foreground block mb-1">Panel Count</span>
                                <span className="font-display text-4xl font-bold text-foreground">{results.panelCount}</span>
                                <span className="text-[10px] text-muted-foreground font-mono mt-1">Confirmed Units</span>
                              </div>

                              <div className="glass-card rounded-xl p-4 flex flex-col items-center justify-center">
                                <span className="font-mono-tactical text-[9px] text-muted-foreground block mb-1">Model Confidence</span>
                                <ConfidenceCircle value={results.confidence} />
                              </div>
                            </div>

                            {/* View AI Detection Overlay Shortcut */}
                            {results.annotatedImage && (
                              <button
                                type="button"
                                onClick={() => setDisplayMode(displayMode === 'annotated' ? '3d' : 'annotated')}
                                className="glass-card rounded-xl p-3 flex items-center justify-between border border-primary/40 hover:border-primary transition-all bg-primary/10 hover:bg-primary/20 text-left group"
                              >
                                <div className="flex items-center gap-2.5">
                                  <div className="p-1.5 rounded-lg bg-primary/20 text-primary">
                                    <Crosshair className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <div className="text-xs font-mono font-bold text-foreground group-hover:text-primary transition-colors">
                                      {displayMode === 'annotated' ? "Back to 3D Terrain View" : "View AI Detection Overlay"}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground font-mono">
                                      {results.panelCount > 0 ? `${results.panelCount} solar panels boxed & highlighted` : "Inspect viewport detection frame"}
                                    </div>
                                  </div>
                                </div>
                                <ChevronRight className="w-4 h-4 text-primary group-hover:translate-x-1 transition-transform" />
                              </button>
                            )}
                          </motion.div>
                        ) : activeTab === 'detailed' ? (
                          <motion.div
                            key="detailed"
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            className="space-y-2.5"
                          >
                            <div className="flex justify-between items-center p-2.5 rounded-lg bg-muted/20">
                              <span className="text-xs text-muted-foreground">Target Coordinates:</span>
                              <span className="text-sm font-mono text-foreground">{parseFloat(lat).toFixed(4)}°N, {parseFloat(lon).toFixed(4)}°E</span>
                            </div>

                            <div className="flex justify-between items-center p-2.5 rounded-lg bg-muted/20">
                              <span className="text-xs text-muted-foreground">Power Estimate:</span>
                              <span className="text-sm font-mono text-foreground font-bold">{results.powerEstimateKw} kW</span>
                            </div>

                            <div className="flex justify-between items-center p-2.5 rounded-lg bg-muted/20">
                              <span className="text-xs text-muted-foreground">Active PV Area:</span>
                              <span className="text-sm font-mono text-foreground">{results.areaEstimateSqm} m²</span>
                            </div>

                            <div className="flex justify-between items-center p-2.5 rounded-lg bg-muted/20">
                              <span className="text-xs text-muted-foreground">Buffer Radius:</span>
                              <span className="text-sm font-mono text-primary font-bold">{results.bufferRadius || (bufferRadius === "1200" ? "1,200 ft" : "2,400 ft")}</span>
                            </div>

                            <div className="flex justify-between items-center p-2.5 rounded-lg bg-muted/20">
                              <span className="text-xs text-muted-foreground">QC Status:</span>
                              <span className={`text-sm font-mono font-bold ${results.detected ? "text-success" : "text-destructive"}`}>
                                {results.detected ? "VERIFIABLE" : "NO_SOLAR"}
                              </span>
                            </div>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="logs"
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            className="space-y-2 h-full flex flex-col justify-center"
                          >
                            <ul className="space-y-2.5">
                              {results.qcNotes.slice(0, 4).map((note, i) => (
                                <li key={i} className="flex items-start gap-2.5 bg-muted/20 p-2.5 rounded-lg border border-border/50">
                                  <div className="mt-0.5 rounded-full bg-primary/20 p-1 shrink-0">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                                  </div>
                                  <span className="text-xs text-foreground/90 leading-relaxed font-mono">{note}</span>
                                </li>
                              ))}
                            </ul>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    )}
                  </div>
                </div>

                {/* Right Panel: ArcGIS 3D SceneView (ESRI Satellite Map) */}
                <div className="lg:col-span-2 glass-card rounded-2xl relative overflow-hidden h-[480px]">
                  {/* View Mode Toggle Pill (3D Map vs AI Detection Overlay) */}
                  {results?.annotatedImage && (
                    <div className="absolute top-3 left-3 z-[60] flex items-center gap-1.5 glass-card rounded-xl p-1 bg-background/80 backdrop-blur border border-primary/30 shadow-lg">
                      <button
                        type="button"
                        onClick={() => setDisplayMode('3d')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all flex items-center gap-1.5 ${
                          displayMode === '3d'
                            ? "bg-primary/20 border border-primary text-primary font-bold shadow-[0_0_10px_rgba(0,247,255,0.2)]"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        3D Terrain View
                      </button>
                      <button
                        type="button"
                        onClick={() => setDisplayMode('annotated')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all flex items-center gap-1.5 ${
                          displayMode === 'annotated'
                            ? "bg-primary/20 border border-primary text-primary font-bold shadow-[0_0_10px_rgba(0,247,255,0.2)]"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Crosshair className="w-3.5 h-3.5 text-primary" />
                        AI Detection Overlay
                        {results.detected && (
                          <span className="ml-1 px-1.5 py-0.5 bg-primary/30 text-primary text-[10px] rounded-full font-mono">
                            {results.panelCount}
                          </span>
                        )}
                      </button>
                    </div>
                  )}

                  {/* HUD Telemetry Banner */}
                  <div className="absolute top-3 right-3 z-[60] glass-card rounded-lg px-3 py-2 bg-background/60 backdrop-blur flex flex-col gap-1 border border-border/50 pointer-events-none">
                    <span className="font-mono-tactical text-[10px] text-foreground">ALT: {altitude}m</span>
                    <span className="font-mono-tactical text-[10px] text-foreground">PITCH: {tilt}°</span>
                    <span className="font-mono-tactical text-[9px] text-primary">BUFFER: {bufferRadius === "1200" ? "1,200 ft" : "2,400 ft"}</span>
                  </div>

                  {/* 3D Map Container */}
                  <div
                    ref={sceneElementRef}
                    className={`absolute inset-0 z-0 bg-muted/20 transition-all ${
                      displayMode === '3d' ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    } ${isImmobilized ? "pointer-events-none select-none" : ""}`}
                  />

                  {/* AI Annotated Detection Image View */}
                  {displayMode === 'annotated' && results?.annotatedImage && (
                    <div className="absolute inset-0 z-10 bg-background/90 backdrop-blur-sm flex flex-col items-center justify-center p-3 pb-16">
                      <div className="relative max-w-full max-h-full flex items-center justify-center rounded-xl overflow-hidden border border-primary/40 shadow-[0_0_30px_rgba(0,247,255,0.15)] bg-black/60">
                        <img
                          src={results.annotatedImage}
                          alt="AI Detection Overlay"
                          className="max-h-[380px] w-auto object-contain rounded-lg select-none"
                        />
                        <div className="absolute bottom-2.5 left-2.5 glass-card bg-background/85 px-3 py-1 rounded-md border border-primary/30 flex items-center gap-2">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                          </span>
                          <span className="font-mono text-[11px] text-foreground font-semibold">
                            {results.panelCount > 0
                              ? `${results.panelCount} Solar Panels Highlighted in Zone`
                              : "No Solar Panels Identified in Viewport"}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Immobilization Overlay when 3D map is locked & screenshot is being captured */}
                  <AnimatePresence>
                    {isImmobilized && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-40 bg-background/40 backdrop-blur-[2px] flex flex-col items-center justify-center pointer-events-none"
                      >
                        <div className="relative w-36 h-36 mb-4">
                          <div className="absolute inset-0 rounded-full border border-primary/30 animate-ping opacity-60" />
                          <div className="absolute inset-2 rounded-full border border-primary/40 animate-pulse" />
                          <div className="absolute inset-6 rounded-full border-t-2 border-primary animate-spin" />
                          <div className="absolute top-1/2 left-0 right-0 h-px bg-primary/40" />
                          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-primary/40" />
                        </div>
                        <div className="glass-card rounded-xl px-4 py-2 bg-background/80 border border-primary/40 text-center">
                          <div className="font-mono-tactical text-xs text-primary font-bold tracking-wider mb-1 flex items-center justify-center gap-1.5">
                            <Shield className="w-3.5 h-3.5 animate-pulse" />
                            FEED IMMOBILIZED — CAPTURING VIEWPORT
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            Buffer Range: {bufferRadius === "1200" ? "1,200 ft" : "2,400 ft"} | Processing Weights
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* 3D Camera Controls */}
                  {displayMode === '3d' && (
                    <div className="absolute bottom-20 right-3 z-[50] flex flex-col gap-2">
                      <button
                        onClick={() => {
                          const v = sceneViewRef.current;
                          if (!v) return;
                          const newTilt = tilt > 30 ? 0 : 65;
                          v.goTo({ tilt: newTilt }, { duration: 600 });
                        }}
                        disabled={isImmobilized}
                        className="glass-card rounded-lg p-2 bg-background/80 hover:border-primary/40 disabled:opacity-50"
                        title="Toggle Tilt"
                      >
                        <Eye className="w-4 h-4 text-primary" />
                      </button>
                      <button
                        onClick={() => {
                          const v = sceneViewRef.current;
                          if (!v) return;
                          const z = bufferRadius === "2400" ? 850 : 420;
                          v.goTo({
                            position: { latitude: parseFloat(lat), longitude: parseFloat(lon), z },
                            tilt: 45,
                            heading: 0
                          }, { duration: 800 });
                        }}
                        disabled={isImmobilized}
                        className="glass-card rounded-lg p-2 bg-background/80 hover:border-primary/40 disabled:opacity-50"
                        title="Reset Viewpoint"
                      >
                        <Home className="w-4 h-4 text-primary" />
                      </button>
                    </div>
                  )}

                  {/* Bottom Action Bar */}
                  <div className="absolute bottom-0 left-0 right-0 z-[50] flex gap-px border-t border-border rounded-b-2xl">
                    <div className="flex-1 bg-background/80 backdrop-blur-sm px-4 py-3 flex flex-wrap items-center justify-between min-h-[60px]">
                      <div className="flex items-center gap-2">
                        {saved ? (
                          <div className="glass-card rounded-lg px-3 py-2 flex items-center gap-2 bg-success/10 border-success/30">
                            <CheckCircle2 className="w-4 h-4 text-success" />
                            <span className="font-mono-tactical text-[10px] text-success uppercase">Stored</span>
                          </div>
                        ) : (
                          <button
                            onClick={saveToDb}
                            disabled={saving || !results}
                            className="glass-card rounded-lg px-3 py-2 flex items-center gap-2 hover:border-primary/50 transition-colors bg-background/50 disabled:opacity-50"
                          >
                            <Save className="w-4 h-4 text-primary" />
                            <span className="font-mono-tactical text-[10px] text-primary uppercase">{saving ? "Saving..." : "Save Result"}</span>
                          </button>
                        )}
                        <button
                          onClick={downloadJson}
                          disabled={!results}
                          className="glass-card rounded-lg px-3 py-2 flex items-center gap-2 hover:border-primary/50 transition-colors bg-background/50 disabled:opacity-50"
                        >
                          <Download className="w-4 h-4 text-primary" />
                          <span className="font-mono-tactical text-[10px] text-primary uppercase">Extract JSON</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={resetScan}
                          className="glass-card rounded-lg px-4 py-2 text-sm text-foreground hover:bg-primary/20 hover:border-primary/50 flex items-center bg-background/50"
                        >
                          <RotateCcw className="w-3 h-3 mr-2" />
                          Reset Scan
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Analysis;
