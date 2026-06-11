"""
Environment panel — configure and manage Gym-style environments natively in LeRobot.

Supports:
1. Simulation (EnvHub): Load simulated tasks directly from Hugging Face Hub (e.g. PushT, Aloha Sim) and run teleop/data recording.
2. Physical Hardware: Configure physical Leader/Follower setups and run actual hardware calibration/teleoperation.

When actions are triggered in the GUI, the actual LeRobot CLI command is typed and run
directly inside the developer terminal console!
"""

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QComboBox, QDialog, QDialogButtonBox, QFormLayout, QGroupBox, QHBoxLayout,
    QLabel, QLineEdit, QMessageBox, QPushButton, QVBoxLayout, QWidget, QStackedWidget,
)

from orchiday.core.project_manager import ProjectManager
from orchiday.core.events import event_bus
from orchiday.core.constants import LEROBOT_SUPPORTED_ROBOTS
from orchiday.ui import (
    TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, FONT_SIZE_XL, FONT_SIZE_LG,
    SUCCESS, BORDER, BG_MEDIUM,
)
from orchiday.ui.widgets import StatusIndicator


class NewRobotDialog(QDialog):
    """
    Dialog for adding a new LeRobot Leader/Follower physical arm setup.
    """

    def __init__(self, project_manager: ProjectManager, parent=None):
        super().__init__(parent)
        self._pm = project_manager
        self.setWindowTitle("Add LeRobot Hardware Setup")
        self.setMinimumWidth(560)
        self.setModal(True)
        self._setup_ui()

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(16)
        layout.setContentsMargins(24, 24, 24, 24)

        title = QLabel("Add LeRobot Physical Setup")
        title.setStyleSheet(f"font-size: {FONT_SIZE_XL}; font-weight: 700;")
        layout.addWidget(title)

        subtitle = QLabel("Configure standard LeRobot leader/follower physical arms. Port and calibration settings will be managed natively.")
        subtitle.setStyleSheet(f"color: {TEXT_SECONDARY}; font-size: 12px;")
        layout.addWidget(subtitle)

        # Setup ID
        form = QFormLayout()
        self._id_input = QLineEdit("so_setup_1")
        self._id_input.setPlaceholderText("e.g. so101_setup")
        form.addRow("Setup Identifier:", self._id_input)
        layout.addLayout(form)

        from orchiday.hardware.detection import detect_serial_ports
        detected_ports = detect_serial_ports()

        # Follower Group
        follower_group = QGroupBox("Follower Arm (Physical Robot)")
        follower_form = QFormLayout(follower_group)
        follower_form.setSpacing(8)

        self._follower_type = QComboBox()
        for r in LEROBOT_SUPPORTED_ROBOTS:
            if "leader" not in r["type"]:
                self._follower_type.addItem(r["label"], r["type"])
        follower_form.addRow("Follower Type:", self._follower_type)

        self._follower_port = QComboBox()
        for device, name in detected_ports:
            self._follower_port.addItem(name, device)
        self._follower_port.addItem("Custom Port...", "custom")
        follower_form.addRow("Follower Port:", self._follower_port)

        self._follower_custom_port = QLineEdit()
        self._follower_custom_port.setPlaceholderText("e.g. /dev/ttyUSB0 or COM3")
        self._follower_custom_port.setVisible(len(detected_ports) == 0)
        self._follower_port.currentIndexChanged.connect(
            lambda: self._follower_custom_port.setVisible(self._follower_port.currentData() == "custom")
        )
        follower_form.addRow("Custom Port:", self._follower_custom_port)

        self._follower_id = QLineEdit("F1")
        follower_form.addRow("Follower ID:", self._follower_id)
        layout.addWidget(follower_group)

        # Leader Group
        leader_group = QGroupBox("Leader Arm (Teleoperation Device)")
        leader_form = QFormLayout(leader_group)
        leader_form.setSpacing(8)

        self._leader_type = QComboBox()
        for r in LEROBOT_SUPPORTED_ROBOTS:
            if "follower" not in r["type"]:
                self._leader_type.addItem(r["label"], r["type"])
        idx = self._leader_type.findData("so100_leader")
        if idx >= 0:
            self._leader_type.setCurrentIndex(idx)
        leader_form.addRow("Leader Type:", self._leader_type)

        self._leader_port = QComboBox()
        for device, name in detected_ports:
            self._leader_port.addItem(name, device)
        self._leader_port.addItem("Custom Port...", "custom")
        if len(detected_ports) > 1:
            self._leader_port.setCurrentIndex(1)
        leader_form.addRow("Leader Port:", self._leader_port)

        self._leader_custom_port = QLineEdit()
        self._leader_custom_port.setPlaceholderText("e.g. /dev/ttyUSB1 or COM4")
        self._leader_custom_port.setVisible(len(detected_ports) == 0)
        self._leader_port.currentIndexChanged.connect(
            lambda: self._leader_custom_port.setVisible(self._leader_port.currentData() == "custom")
        )
        leader_form.addRow("Custom Port:", self._leader_custom_port)

        self._leader_id = QLineEdit("L1")
        leader_form.addRow("Leader ID:", self._leader_id)
        layout.addWidget(leader_group)

        # Teleoperation parameters
        params_group = QGroupBox("Control Parameters")
        params_form = QFormLayout(params_group)
        self._fps_combo = QComboBox()
        self._fps_combo.addItems(["30", "60", "15"])
        self._fps_combo.setCurrentText("30")
        params_form.addRow("Control Frequency (FPS):", self._fps_combo)
        layout.addWidget(params_group)

        # Buttons
        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Add Setup")
        buttons.button(QDialogButtonBox.StandardButton.Ok).setObjectName("primary_button")
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    @property
    def robot_config(self) -> dict:
        follower_p = self._follower_port.currentData()
        follower_port = self._follower_custom_port.text().strip() if follower_p == "custom" else follower_p

        leader_p = self._leader_port.currentData()
        leader_port = self._leader_custom_port.text().strip() if leader_p == "custom" else leader_p

        return {
            "id": self._id_input.text().strip() or "so_setup_1",
            "type": self._follower_type.currentData(),  # Backward compat
            "label": f"LeRobot Setup: {self._follower_id.text()}/{self._leader_id.text()}",
            "follower_type": self._follower_type.currentData(),
            "follower_port": follower_port or "COM3",
            "follower_id": self._follower_id.text().strip() or "F1",
            "leader_type": self._leader_type.currentData(),
            "leader_port": leader_port or "COM4",
            "leader_id": self._leader_id.text().strip() or "L1",
            "fps": int(self._fps_combo.currentText()),
            # Backward compat structures
            "port": follower_port or "COM3",
            "baudrate": 1000000,
            "cameras": [],
            "safety": {
                "slew_rate_limit": 0.05,
                "lowpass_alpha": 0.25,
                "watchdog_timeout_s": 5.0,
            }
        }


class RobotCard(QWidget):
    """Card displaying a single LeRobot leader/follower physical arm setup."""

    remove_requested = Signal(str)

    def __init__(self, robot_data: dict, parent=None):
        super().__init__(parent)
        self._data = robot_data
        self._setup_ui()

    def _setup_ui(self) -> None:
        self.setStyleSheet(f"""
            RobotCard {{
                background-color: {BG_MEDIUM}; border: 1px solid {BORDER};
                border-radius: 10px; padding: 12px;
            }}
        """)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 10, 12, 10)
        layout.setSpacing(8)

        # Header
        header = QHBoxLayout()
        self._status = StatusIndicator(state="idle")
        header.addWidget(self._status)

        name = QLabel(self._data.get("label", "LeRobot Setup"))
        name.setStyleSheet(f"font-weight: 600; font-size: 12px; background: transparent; color: {TEXT_PRIMARY};")
        header.addWidget(name)
        header.addStretch()

        # Remove
        remove_btn = QPushButton("X")
        remove_btn.setObjectName("danger_button")
        remove_btn.setFixedSize(20, 20)
        remove_btn.setStyleSheet("font-size: 8px; padding: 0;")
        remove_btn.clicked.connect(lambda: self.remove_requested.emit(self._data["id"]))
        header.addWidget(remove_btn)
        layout.addLayout(header)

        # Specs
        specs = QHBoxLayout()
        specs.setSpacing(12)
        
        follower_info = QVBoxLayout()
        follower_info.setSpacing(2)
        fl = QLabel("🤖 FOLLOWER (ROBOT)")
        fl.setStyleSheet(f"font-weight: bold; font-size: 9px; color: {ACCENT_PRIMARY};")
        follower_info.addWidget(fl)
        fd = QLabel(f"Type: {self._data.get('follower_type', 'so101_follower')}\nID: {self._data.get('follower_id', 'F1')}\nPort: {self._data.get('follower_port', 'COM3')}")
        fd.setStyleSheet(f"font-size: 9px; color: {TEXT_SECONDARY}; line-height: 1.2;")
        follower_info.addWidget(fd)
        specs.addLayout(follower_info)

        leader_info = QVBoxLayout()
        leader_info.setSpacing(2)
        ll = QLabel("🎮 LEADER (TELEOP)")
        ll.setStyleSheet(f"font-weight: bold; font-size: 9px; color: #06b6d4;")
        leader_info.addWidget(ll)
        ld = QLabel(f"Type: {self._data.get('leader_type', 'so101_leader')}\nID: {self._data.get('leader_id', 'L1')}\nPort: {self._data.get('leader_port', 'COM4')}")
        ld.setStyleSheet(f"font-size: 9px; color: {TEXT_SECONDARY}; line-height: 1.2;")
        leader_info.addWidget(ld)
        specs.addLayout(leader_info)
        layout.addLayout(specs)

        # Actions
        actions = QHBoxLayout()
        actions.setSpacing(4)
        
        cal_l_btn = QPushButton("Calibrate Leader")
        cal_l_btn.setFixedHeight(22)
        cal_l_btn.setStyleSheet("font-size: 9px; padding: 1px 5px;")
        cal_l_btn.clicked.connect(self._on_calibrate_leader)
        actions.addWidget(cal_l_btn)

        cal_f_btn = QPushButton("Calibrate Follower")
        cal_f_btn.setFixedHeight(22)
        cal_f_btn.setStyleSheet("font-size: 9px; padding: 1px 5px;")
        cal_f_btn.clicked.connect(self._on_calibrate_follower)
        actions.addWidget(cal_f_btn)

        teleop_btn = QPushButton("Teleoperate")
        teleop_btn.setObjectName("primary_button")
        teleop_btn.setFixedHeight(22)
        teleop_btn.setStyleSheet("font-size: 9px; font-weight: 600; padding: 1px 8px;")
        teleop_btn.clicked.connect(self._on_teleoperate)
        actions.addWidget(teleop_btn)

        layout.addLayout(actions)

    def _type_command(self, cmd: str) -> None:
        event_bus.console_output.emit(f'<br/><span style="color:#39ff14;font-weight:bold;font-family:monospace;">$ {cmd}</span>')
        event_bus.terminal_command_requested.emit(cmd)

    def _on_calibrate_leader(self) -> None:
        l_type = self._data.get("leader_type", "so101_leader")
        l_port = self._data.get("leader_port", "COM4")
        l_id = self._data.get("leader_id", "L1")
        cmd = f"lerobot-calibrate --teleop.type={l_type} --teleop.port={l_port} --teleop.id={l_id}"
        self._type_command(cmd)

    def _on_calibrate_follower(self) -> None:
        f_type = self._data.get("follower_type", "so101_follower")
        f_port = self._data.get("follower_port", "COM3")
        f_id = self._data.get("follower_id", "F1")
        cmd = f"lerobot-calibrate --robot.type={f_type} --robot.port={f_port} --robot.id={f_id}"
        self._type_command(cmd)

    def _on_teleoperate(self) -> None:
        f_type = self._data.get("follower_type", "so101_follower")
        f_port = self._data.get("follower_port", "COM3")
        f_id = self._data.get("follower_id", "F1")
        
        l_type = self._data.get("leader_type", "so101_leader")
        l_port = self._data.get("leader_port", "COM4")
        l_id = self._data.get("leader_id", "L1")
        
        fps = self._data.get("fps", 30)

        cmd = (
            f"lerobot-teleoperate "
            f"--robot.type={f_type} --robot.port={f_port} --robot.id={f_id} "
            f"--teleop.type={l_type} --teleop.port={l_port} --teleop.id={l_id} "
            f"--fps={fps} --robot.disable_torque_on_disconnect=False"
        )
        self._status.set_state("connected")
        self._type_command(cmd)


class RobotPanel(QWidget):
    """Unified Environment (Env) Panel — manage simulation (EnvHub) and real physical hardware in standard Gym layouts."""

    def __init__(self, project_manager: ProjectManager, compact: bool = False, parent=None):
        super().__init__(parent)
        self._pm = project_manager
        self._compact = compact
        self._cards: dict[str, RobotCard] = {}
        self._setup_ui()
        self._refresh()

        event_bus.robot_added.connect(lambda _: self._refresh())
        event_bus.robot_removed.connect(lambda _: self._refresh())
        event_bus.project_opened.connect(lambda _: self._refresh())

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(6 if self._compact else 16)
        if self._compact:
            layout.setContentsMargins(4, 4, 4, 4)
        else:
            layout.setContentsMargins(32, 32, 32, 32)

        # Mode Selector: Simulation (EnvHub) vs Physical Hardware
        mode_row = QHBoxLayout()
        mode_row.setSpacing(8)
        
        mode_lbl = QLabel("Env Category:")
        mode_lbl.setStyleSheet("font-weight: bold; font-size: 11px; color: #aaa; background: transparent;")
        mode_row.addWidget(mode_lbl)

        self._mode_combo = QComboBox()
        self._mode_combo.addItems(["Simulation (EnvHub)", "Physical Hardware"])
        self._mode_combo.setStyleSheet("""
            QComboBox {
                background-color: #161b22; border: 1px solid #30363d; border-radius: 4px;
                color: #e6edf3; font-size: 11px; padding: 2px 6px; min-width: 130px;
            }
        """)
        self._mode_combo.currentIndexChanged.connect(self._on_mode_changed)
        mode_row.addWidget(self._mode_combo)
        mode_row.addStretch()

        # Architecture dropdown (still relevant for policies)
        arch_label = QLabel("Policy:")
        arch_label.setStyleSheet("font-weight: bold; font-size: 11px; color: #aaa; background: transparent;")
        mode_row.addWidget(arch_label)

        self._global_arch_combo = QComboBox()
        from orchiday.core.constants import SUPPORTED_ARCHITECTURES
        self._global_arch_combo.addItems(SUPPORTED_ARCHITECTURES)
        self._global_arch_combo.setStyleSheet("""
            QComboBox {
                background-color: #161b22; border: 1px solid #30363d; border-radius: 4px;
                color: #e6edf3; font-size: 10px; padding: 2px 4px; min-width: 80px;
            }
        """)
        self._global_arch_combo.currentIndexChanged.connect(self._on_global_arch_changed)
        mode_row.addWidget(self._global_arch_combo)

        layout.addLayout(mode_row)

        # Stacked widgets to switch between Simulation view and Physical view
        self._stacked = QStackedWidget()
        
        # 1. SIMULATION (EnvHub) view
        self._sim_widget = QWidget()
        sim_lay = QVBoxLayout(self._sim_widget)
        sim_lay.setContentsMargins(0, 0, 0, 0)
        sim_lay.setSpacing(6)
        
        sim_card = QWidget()
        sim_card.setStyleSheet(f"background-color: {BG_MEDIUM}; border: 1px solid {BORDER}; border-radius: 10px;")
        sim_card_lay = QVBoxLayout(sim_card)
        sim_card_lay.setContentsMargins(12, 10, 12, 10)
        sim_card_lay.setSpacing(8)

        sh = QHBoxLayout()
        sh.setSpacing(6)
        sim_icon = QLabel("🌍")
        sim_icon.setStyleSheet("font-size: 14px; background: transparent;")
        sh.addWidget(sim_icon)
        
        sim_title = QLabel("EnvHub Simulator (Gym compatible)")
        sim_title.setStyleSheet("font-weight: 700; font-size: 12px; color: #fff; background: transparent;")
        sh.addWidget(sim_title)
        sh.addStretch()
        sim_card_lay.addLayout(sh)

        form_lay = QFormLayout()
        form_lay.setSpacing(6)
        form_lay.setContentsMargins(0, 0, 0, 0)
        
        self._sim_env_combo = QComboBox()
        self._sim_env_combo.addItems([
            "lerobot/pusht",
            "lerobot/aloha_sim_transfer_cube",
            "lerobot/aloha_sim_insertion",
            "custom"
        ])
        self._sim_env_combo.setStyleSheet("font-size: 11px; padding: 3px; height: 18px;")
        self._sim_env_combo.currentIndexChanged.connect(self._on_sim_env_changed)
        form_lay.addRow("Env ID:", self._sim_env_combo)

        self._custom_env_input = QLineEdit()
        self._custom_env_input.setPlaceholderText("Enter custom Hub env, e.g. lerobot/pusht")
        self._custom_env_input.setStyleSheet("font-size: 11px; padding: 3px; height: 18px;")
        self._custom_env_input.setVisible(False)
        form_lay.addRow("Custom ID:", self._custom_env_input)
        sim_card_lay.addLayout(form_lay)

        # Simulation control row
        sim_actions = QHBoxLayout()
        sim_actions.setSpacing(6)
        
        self._sim_teleop_btn = QPushButton("Start Simulation")
        self._sim_teleop_btn.setObjectName("primary_button")
        self._sim_teleop_btn.setFixedHeight(24)
        self._sim_teleop_btn.setStyleSheet("font-size: 10px; font-weight: 600; padding: 2px 10px;")
        self._sim_teleop_btn.clicked.connect(self._on_sim_teleoperate)
        sim_actions.addWidget(self._sim_teleop_btn)

        self._sim_record_btn = QPushButton("Record Episode")
        self._sim_record_btn.setFixedHeight(24)
        self._sim_record_btn.setStyleSheet("font-size: 10px; padding: 2px 10px;")
        self._sim_record_btn.clicked.connect(self._on_sim_record)
        sim_actions.addWidget(self._sim_record_btn)
        sim_card_lay.addLayout(sim_actions)
        
        sim_lay.addWidget(sim_card)
        self._stacked.addWidget(self._sim_widget)

        # 2. PHYSICAL HARDWARE view
        self._phys_widget = QWidget()
        phys_lay = QVBoxLayout(self._phys_widget)
        phys_lay.setContentsMargins(0, 0, 0, 0)
        phys_lay.setSpacing(6)

        phys_header = QHBoxLayout()
        p_title = QLabel("Standard Leader/Follower")
        p_title.setStyleSheet("font-weight: 600; font-size: 11px; color: #888; background: transparent;")
        phys_header.addWidget(p_title)
        phys_header.addStretch()

        add_btn = QPushButton("+ Add Setup")
        add_btn.setObjectName("primary_button")
        add_btn.setFixedHeight(22)
        add_btn.setStyleSheet("font-size: 9px; padding: 1px 6px;")
        add_btn.clicked.connect(self._on_add_robot)
        phys_header.addWidget(add_btn)
        phys_lay.addLayout(phys_header)

        self._cards_container = QWidget()
        self._cards_layout = QVBoxLayout(self._cards_container)
        self._cards_layout.setSpacing(6)
        self._cards_layout.setContentsMargins(0, 0, 0, 0)
        self._cards_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
        phys_lay.addWidget(self._cards_container, stretch=1)
        
        self._stacked.addWidget(self._phys_widget)
        layout.addWidget(self._stacked, stretch=1)

        # Real-time safety telemetry chart at bottom
        from orchiday.ui.widgets.telemetry_chart import LiveTelemetryPanel
        self._telemetry_panel = LiveTelemetryPanel()
        layout.addWidget(self._telemetry_panel)

    def _on_mode_changed(self, index: int) -> None:
        self._stacked.setCurrentIndex(index)

    def _on_sim_env_changed(self) -> None:
        data = self._sim_env_combo.currentText()
        self._custom_env_input.setVisible(data == "custom")

    def _type_command(self, cmd: str) -> None:
        event_bus.console_output.emit(f'<br/><span style="color:#39ff14;font-weight:bold;font-family:monospace;">$ {cmd}</span>')
        event_bus.terminal_command_requested.emit(cmd)

    def _get_active_env_id(self) -> str:
        text = self._sim_env_combo.currentText()
        if text == "custom":
            return self._custom_env_input.text().strip() or "lerobot/pusht"
        return text

    def _on_sim_teleoperate(self) -> None:
        env_id = self._get_active_env_id()
        cmd = f"lerobot-teleoperate --env.type={env_id} --fps=30"
        self._type_command(cmd)

    def _on_sim_record(self) -> None:
        env_id = self._get_active_env_id()
        cmd = f"lerobot-record --env.type={env_id} --fps=30 --num-episodes=50 --push-to-hub=0"
        self._type_command(cmd)

    def _refresh(self) -> None:
        while self._cards_layout.count():
            child = self._cards_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        self._cards.clear()

        if self._pm.current_project is None:
            return

        arch = self._pm.current_project.get("policy_architecture", "diffusion")
        idx = self._global_arch_combo.findText(arch)
        if idx >= 0:
            self._global_arch_combo.blockSignals(True)
            self._global_arch_combo.setCurrentIndex(idx)
            self._global_arch_combo.blockSignals(False)

        robots = self._pm.current_project.get("robots", [])
        if not robots:
            empty = QLabel("No hardware setups added. Switch category or click '+ Add Setup'.")
            empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
            empty.setStyleSheet(f"color: {TEXT_MUTED}; padding: 12px; font-size: 11px;")
            self._cards_layout.addWidget(empty)
            return

        for robot in robots:
            card = RobotCard(robot)
            card.remove_requested.connect(self._on_remove_robot)
            self._cards[robot["id"]] = card
            self._cards_layout.addWidget(card)

    def _on_global_arch_changed(self, index: int) -> None:
        if not self._pm.current_project:
            return
        arch = self._global_arch_combo.currentText()
        self._pm.current_project["policy_architecture"] = arch
        self._pm.save_project()
        event_bus.log_message.emit("SUCCESS", f"Global policy architecture updated to: {arch}")

    def _on_add_robot(self) -> None:
        dialog = NewRobotDialog(self._pm, self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            try:
                self._pm.add_robot(dialog.robot_config)
            except Exception as e:
                QMessageBox.critical(self, "Error", str(e))

    def _on_remove_robot(self, robot_id: str) -> None:
        reply = QMessageBox.question(
            self, "Remove Setup",
            f"Remove LeRobot setup '{robot_id}' from this project?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if reply == QMessageBox.StandardButton.Yes:
            self._pm.remove_robot(robot_id)
