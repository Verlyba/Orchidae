"""
Hardware detection helper — lists available USB/serial ports and camera devices
with robust, persistent physical device identification signatures.
"""

import os
import logging
import cv2

log = logging.getLogger(__name__)


def detect_serial_ports() -> list[dict]:
    """
    Scan and return available serial/COM ports with persistent hardware IDs.

    Returns:
        List of dicts containing device paths, serial numbers, locations,
        and fully persistent unique identifiers.
    ```
    """
    ports = []
    try:
        import serial.tools.list_ports
        for p in serial.tools.list_ports.comports():
            # Build an intelligent, robust, persistent hardware signature
            vid = p.vid if p.vid is not None else 0
            pid = p.pid if p.pid is not None else 0
            
            if p.serial_number:
                persistent_id = f"serial-sn-{p.serial_number}"
            elif p.location:
                persistent_id = f"serial-loc-{vid:04x}:{pid:04x}-{p.location}"
            else:
                persistent_id = f"serial-hwid-{p.hwid.replace(' ', '_')}"

            # Make a beautiful friendly description
            desc = p.description or "USB Serial Device"
            sn_suffix = f" [SN: {p.serial_number}]" if p.serial_number else ""
            friendly_name = f"{p.device} — {desc}{sn_suffix}"

            ports.append({
                "device": p.device,
                "description": desc,
                "serial_number": p.serial_number,
                "vid": vid,
                "pid": pid,
                "location": p.location,
                "persistent_id": persistent_id,
                "friendly_name": friendly_name
            })
    except ImportError:
        log.warning("pyserial package not installed, serial port detection unavailable.")
    except Exception as e:
        log.warning("Failed to detect serial ports: %s", e)
    
    # If empty, add dummy placeholders to test on sandbox
    if not ports:
        log.debug("No physical serial ports detected, returning empty list.")
        
    return ports


def detect_cameras() -> list[dict]:
    """
    Scan and return available video camera devices with persistent physical IDs.
    Directly queries Linux sysfs /sys/class/video4linux to extract vendor names,
    USB ports, and hardware serial numbers. Fallbacks to OpenCV index scanning.

    Returns:
        List of dicts containing camera indexes, device paths, models,
        and persistent unique identifiers.
    """
    cameras = []
    v4l_path = "/sys/class/video4linux"

    if os.path.exists(v4l_path):
        try:
            # Gather all video device folders under sysfs
            devices = sorted([d for d in os.listdir(v4l_path) if d.startswith("video")])
            for d in devices:
                try:
                    index = int(d.replace("video", ""))
                    device_path = f"/dev/{d}"
                    
                    # 1. Get model name
                    name_file = os.path.join(v4l_path, d, "name")
                    model_name = "Unknown Camera"
                    if os.path.exists(name_file):
                        with open(name_file, "r") as f:
                            model_name = f.read().strip()
                    
                    # Ignore non-capture video interfaces (metadata/radio/etc)
                    if "metadata" in model_name.lower() or "dec" in model_name.lower():
                        continue

                    # 2. Get USB serial number & physical location slot
                    serial = None
                    location = None
                    
                    # Walk up the device sysfs parent chain to find serial/location info
                    sys_device_link = os.path.join(v4l_path, d, "device")
                    if os.path.exists(sys_device_link):
                        real_device_path = os.path.realpath(sys_device_link)
                        curr = real_device_path
                        # Iterate up to 5 levels to find the USB interface properties
                        for _ in range(5):
                            if not curr or curr == "/" or "devices" not in curr:
                                break
                            
                            # Check for serial
                            serial_file = os.path.join(curr, "serial")
                            if os.path.exists(serial_file) and not serial:
                                with open(serial_file, "r") as f:
                                    serial = f.read().strip()
                            
                            # Check for USB interface location from folder name (e.g. 1-1.3:1.0)
                            dirname = os.path.basename(curr)
                            if ":" in dirname and not location:
                                location = dirname.split(":")[0]
                                
                            curr = os.path.dirname(curr)

                    # 3. Construct a highly robust persistent ID
                    if serial:
                        persistent_id = f"camera-serial-{serial}"
                    elif location:
                        persistent_id = f"camera-loc-{location}"
                    else:
                        persistent_id = f"camera-model-{model_name.replace(' ', '_')}-{index}"

                    friendly_name = f"{device_path} — {model_name} (index {index})"
                    
                    cameras.append({
                        "index": index,
                        "device": device_path,
                        "model_name": model_name,
                        "serial_number": serial,
                        "location": location,
                        "persistent_id": persistent_id,
                        "friendly_name": friendly_name
                    })
                except Exception:
                    pass
        except Exception as e:
            log.warning("Linux sysfs camera scanning failed: %s. Falling back to OpenCV.", e)

    # Fallback to standard OpenCV scanning if sysfs returned nothing (or on non-Linux).
    # Uses the platform's native backend (DSHOW/AVFoundation/V4L2) — probing with
    # OpenCV's default backend takes seconds per index on Windows.
    if not cameras:
        from orchiday.hardware.camera_utils import (
            open_capture, camera_device_label, is_source_active)
        log.info("Sysfs scan empty, scanning OpenCV indexes 0-5...")
        for i in range(6):
            # NEVER probe a device that a CameraWorker is streaming — a second
            # concurrent handle crashes the native Windows capture backends.
            # The device obviously exists, so report it directly instead.
            if is_source_active(i):
                device = camera_device_label(i)
                cameras.append({
                    "index": i,
                    "device": device,
                    "model_name": "OpenCV Webcam",
                    "serial_number": None,
                    "location": None,
                    "persistent_id": f"camera-index-{i}",
                    "friendly_name": f"{device} — OpenCV Webcam (index {i})"
                })
                continue
            try:
                cap = open_capture(i)
                if cap.isOpened():
                    ret, _ = cap.read()
                    if ret:
                        device = camera_device_label(i)
                        cameras.append({
                            "index": i,
                            "device": device,
                            "model_name": "OpenCV Webcam",
                            "serial_number": None,
                            "location": None,
                            "persistent_id": f"camera-index-{i}",
                            "friendly_name": f"{device} — OpenCV Webcam (index {i})"
                        })
                    cap.release()
            except Exception:
                pass

    return cameras
