from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import math
from typing import Any


DEFAULT_BATTERY_VOLTAGE = 5.0
DEFAULT_SAMPLE_COUNT = 121
DEFAULT_DURATION = 0.12
DEFAULT_EVENT_TIME = 0.04
LED_OFF_RESISTANCE = 1e9
LED_TURN_ON_EPSILON = 1e-6
LED_MAX_ITERATIONS = 8

DEFAULT_COMPONENT_PARAMETERS = {
    "battery": {"voltage": 5.0},
    "resistor": {"resistance": 220.0},
    "led": {"resistance": 180.0, "forwardVoltage": 2.0},
    "lamp": {"resistance": 120.0},
    "motor": {"resistance": 56.0},
    "fan": {"resistance": 68.0},
    "buzzer": {"resistance": 150.0},
    "capacitor": {"capacitance": 0.0001},
    "fuse": {"resistance": 0.2},
}

PROBE_ORDER = (
    "led",
    "lamp",
    "resistor",
    "motor",
    "fan",
    "buzzer",
    "capacitor",
    "fuse",
)


@dataclass
class Element:
    kind: str
    instance_id: str
    component_id: str
    name: str
    node_a: str
    node_b: str
    value: float
    port_a: str
    port_b: str
    forward_voltage: float = 0.0


class UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def add(self, item: str) -> None:
        self.parent.setdefault(item, item)

    def find(self, item: str) -> str:
        self.add(item)
        if self.parent[item] != item:
            self.parent[item] = self.find(self.parent[item])
        return self.parent[item]

    def union(self, left: str, right: str) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root != right_root:
            self.parent[right_root] = left_root


def simulate_circuit(payload: dict[str, Any]) -> dict[str, Any]:
    components = payload.get("components") or []
    connections = payload.get("connections") or []
    final_switch_states = payload.get("switchStates") or {}
    switch_event = payload.get("switchEvent")

    batteries = [component for component in components if component.get("id") == "battery"]
    if not batteries:
        return {
            "ok": False,
            "error": "A battery is required before simulation can run.",
        }

    final_result = solve_snapshot(components, connections, final_switch_states, 1.0, {})
    if not final_result["ok"]:
        return final_result

    initial_switch_states = dict(final_switch_states)
    event_time = None

    if is_valid_switch_event(switch_event, final_switch_states):
        instance_id = switch_event["instanceId"]
        initial_switch_states[instance_id] = bool(switch_event["from"])
        event_time = DEFAULT_EVENT_TIME

    dt = DEFAULT_DURATION / max(DEFAULT_SAMPLE_COUNT - 1, 1)
    capacitor_voltages: dict[str, float] = {}
    samples = []

    for sample_index in range(DEFAULT_SAMPLE_COUNT):
        ratio = sample_index / max(DEFAULT_SAMPLE_COUNT - 1, 1)
        time_value = round(DEFAULT_DURATION * ratio, 6)
        switch_state = (
            initial_switch_states
            if event_time is not None and time_value < event_time
            else final_switch_states
        )

        snapshot = solve_snapshot(
            components,
            connections,
            switch_state,
            1.0,
            capacitor_voltages,
            dt,
        )
        if not snapshot["ok"]:
            return snapshot

        capacitor_voltages = snapshot.get("capacitorVoltages", {})
        summary_values = snapshot["summaryValues"]
        samples.append(
            {
                "time": time_value,
                "supplyVoltage": summary_values["supplyVoltage"],
                "supplyCurrent": summary_values["supplyCurrent"],
                "probeVoltage": summary_values["probeVoltage"],
                "probeCurrent": summary_values["probeCurrent"],
            }
        )

    probe_label = final_result["probe"]["name"] if final_result["probe"] else "Primary load"
    summary_lines = [
        "Python operating-point simulation completed.",
        "Waveforms reflect the current switch state and the latest real switch toggle when available.",
    ]
    if final_result["ignoredComponents"]:
        summary_lines.append(
            f"Ignored {len(final_result['ignoredComponents'])} component(s) outside the powered network."
        )

    return {
        "ok": True,
        "solver": "python-mna-enhanced",
        "summary": " ".join(summary_lines),
        "warnings": final_result.get("warnings", []),
        "metrics": build_metrics(final_result),
        "waveform": {
            "time": [sample["time"] for sample in samples],
            "series": [
                {
                    "key": "supplyVoltage",
                    "label": "Supply voltage",
                    "unit": "V",
                    "color": "#d95f23",
                    "values": [sample["supplyVoltage"] for sample in samples],
                },
                {
                    "key": "supplyCurrent",
                    "label": "Supply current",
                    "unit": "A",
                    "color": "#235d52",
                    "values": [sample["supplyCurrent"] for sample in samples],
                },
                {
                    "key": "probeVoltage",
                    "label": f"{probe_label} voltage",
                    "unit": "V",
                    "color": "#0d7b52",
                    "values": [sample["probeVoltage"] for sample in samples],
                },
                {
                    "key": "probeCurrent",
                    "label": f"{probe_label} current",
                    "unit": "A",
                    "color": "#7c3aed",
                    "values": [sample["probeCurrent"] for sample in samples],
                },
            ],
            "eventTime": event_time,
            "duration": DEFAULT_DURATION,
        },
        "probe": final_result["probe"],
        "operatingPoint": {
            "components": final_result["componentResults"],
            "ignoredComponents": final_result["ignoredComponents"],
        },
    }


def solve_snapshot(
    components: list[dict[str, Any]],
    connections: list[dict[str, Any]],
    switch_states: dict[str, bool],
    source_scale: float,
    capacitor_voltages: dict[str, float],
    dt: float | None = None,
) -> dict[str, Any]:
    if dt is None:
        dt = DEFAULT_DURATION / max(DEFAULT_SAMPLE_COUNT - 1, 1)

    port_nodes = collapse_nodes(components, connections, switch_states)
    elements = build_elements(components, port_nodes, source_scale)

    battery_nodes = []
    for element in elements:
        if element.kind == "vsource":
            battery_nodes.append(element.node_a)
            battery_nodes.append(element.node_b)

    active_nodes = find_active_nodes(elements, battery_nodes)
    if not active_nodes:
        return {
            "ok": False,
            "error": "No active powered circuit could be solved.",
        }

    active_elements = [
        element
        for element in elements
        if element.node_a in active_nodes and element.node_b in active_nodes
    ]
    ignored_components = sorted(
        {
            element.instance_id
            for element in elements
            if element.node_a not in active_nodes or element.node_b not in active_nodes
        }
    )

    sources = [element for element in active_elements if element.kind == "vsource"]
    if not sources:
        return {
            "ok": False,
            "error": "No usable voltage source was found for simulation.",
        }

    ground_node = sources[0].node_b
    node_names = sorted(node for node in active_nodes if node != ground_node)
    node_index = {node_name: index for index, node_name in enumerate(node_names)}
    source_index = {element.instance_id: index for index, element in enumerate(sources)}

    matrix_size = len(node_names) + len(sources)
    if matrix_size == 0:
        return {
            "ok": False,
            "error": "The circuit has no solvable variables.",
        }

    new_capacitor_voltages = dict(capacitor_voltages)
    warnings: list[str] = []
    led_states = {
        element.instance_id: False
        for element in active_elements
        if element.kind == "led"
    }
    node_voltages: dict[str, float] = {}
    source_currents: dict[str, float] = {}

    for _ in range(LED_MAX_ITERATIONS):
        matrix = [[0.0 for _ in range(matrix_size)] for _ in range(matrix_size)]
        rhs = [0.0 for _ in range(matrix_size)]

        for element in active_elements:
            if element.kind == "resistor":
                stamp_resistor(
                    matrix,
                    node_index,
                    ground_node,
                    element.node_a,
                    element.node_b,
                    element.value,
                )
            elif element.kind == "led":
                if led_states.get(element.instance_id):
                    stamp_led_on(
                        matrix,
                        rhs,
                        node_index,
                        ground_node,
                        element.node_a,
                        element.node_b,
                        element.value,
                        element.forward_voltage,
                    )
                else:
                    stamp_resistor(
                        matrix,
                        node_index,
                        ground_node,
                        element.node_a,
                        element.node_b,
                        LED_OFF_RESISTANCE,
                    )
            elif element.kind == "capacitor":
                if source_scale <= 0:
                    continue

                capacitance = max(element.value, 1e-6)
                conductance = capacitance / dt
                previous_voltage = capacitor_voltages.get(element.instance_id, 0.0)

                stamp_resistor(
                    matrix,
                    node_index,
                    ground_node,
                    element.node_a,
                    element.node_b,
                    1.0 / conductance,
                )
                stamp_current_source(
                    rhs,
                    node_index,
                    ground_node,
                    element.node_a,
                    element.node_b,
                    -conductance * previous_voltage,
                )
            elif element.kind == "vsource":
                stamp_voltage_source(
                    matrix,
                    rhs,
                    node_index,
                    source_index,
                    ground_node,
                    element,
                )

        try:
            solution = solve_linear_system(matrix, rhs)
        except ValueError as error:
            return {
                "ok": False,
                "error": str(error),
            }

        node_voltages = {
            node_name: solution[node_offset]
            for node_name, node_offset in node_index.items()
        }
        node_voltages[ground_node] = 0.0
        source_currents = {
            source.instance_id: solution[len(node_names) + source_index[source.instance_id]]
            for source in sources
        }

        updated_led_states: dict[str, bool] = {}
        for element in active_elements:
            if element.kind != "led":
                continue
            branch_voltage = (
                node_voltages.get(element.node_a, 0.0)
                - node_voltages.get(element.node_b, 0.0)
            )
            updated_led_states[element.instance_id] = (
                branch_voltage > element.forward_voltage + LED_TURN_ON_EPSILON
            )

        if updated_led_states == led_states:
            break
        led_states = updated_led_states

    component_results = []
    for element in active_elements:
        voltage = node_voltages.get(element.node_a, 0.0) - node_voltages.get(element.node_b, 0.0)
        current = 0.0
        power = 0.0

        if element.kind == "resistor":
            current = voltage / element.value
            power = voltage * current
        elif element.kind == "led":
            if led_states.get(element.instance_id):
                series_resistance = max(element.value, 1.0)
                current = max((voltage - element.forward_voltage) / series_resistance, 0.0)
                power = voltage * current
            else:
                current = voltage / LED_OFF_RESISTANCE
                power = voltage * current
                if voltage < -LED_TURN_ON_EPSILON:
                    warnings.append(f"{element.name} is reverse-biased and effectively off.")
        elif element.kind == "capacitor":
            capacitance = element.value
            if capacitance > 0 and dt > 0:
                previous_voltage = capacitor_voltages.get(element.instance_id, 0.0)
                current = capacitance * (voltage - previous_voltage) / dt
                power = voltage * current
                new_capacitor_voltages[element.instance_id] = voltage
        elif element.kind == "vsource":
            current = source_currents.get(element.instance_id, 0.0)
            power = voltage * current

        component_results.append(
            {
                "instanceId": element.instance_id,
                "componentId": element.component_id,
                "name": element.name,
                "kind": element.kind,
                "voltage": round(abs(voltage), 6),
                "current": round(abs(current), 6),
                "power": round(abs(power), 6),
                "nodeA": element.node_a,
                "nodeB": element.node_b,
            }
        )

    probe = pick_probe(component_results)
    first_source = sources[0]
    supply_voltage = abs(
        node_voltages.get(first_source.node_a, 0.0) - node_voltages.get(first_source.node_b, 0.0)
    )
    supply_current = abs(source_currents.get(first_source.instance_id, 0.0))

    return {
        "ok": True,
        "probe": probe,
        "warnings": dedupe_list(warnings),
        "componentResults": component_results,
        "ignoredComponents": ignored_components,
        "capacitorVoltages": new_capacitor_voltages,
        "summaryValues": {
            "supplyVoltage": round(supply_voltage, 6),
            "supplyCurrent": round(supply_current, 6),
            "probeVoltage": round(probe["voltage"], 6) if probe else 0.0,
            "probeCurrent": round(probe["current"], 6) if probe else 0.0,
        },
    }


def is_valid_switch_event(
    switch_event: dict[str, Any] | None,
    final_switch_states: dict[str, bool],
) -> bool:
    if not isinstance(switch_event, dict):
        return False

    instance_id = switch_event.get("instanceId")
    before_state = switch_event.get("from")
    after_state = switch_event.get("to")

    if not isinstance(instance_id, str):
        return False
    if not isinstance(before_state, bool) or not isinstance(after_state, bool):
        return False
    if before_state == after_state:
        return False
    if instance_id not in final_switch_states:
        return False

    return bool(final_switch_states.get(instance_id)) == after_state


def collapse_nodes(
    components: list[dict[str, Any]],
    connections: list[dict[str, Any]],
    switch_states: dict[str, bool],
) -> dict[str, str]:
    union_find = UnionFind()

    for component in components:
        for port in component.get("ports") or []:
            union_find.add(make_port_ref(component.get("instanceId"), port.get("id")))

    for connection in connections:
        from_ref = connection.get("from")
        to_ref = connection.get("to")
        if from_ref and to_ref:
            union_find.union(from_ref, to_ref)

    for component in components:
        ports = component.get("ports") or []
        if len(ports) < 2:
            continue

        component_id = component.get("id")
        instance_id = component.get("instanceId")
        first_ref = make_port_ref(instance_id, ports[0].get("id"))
        second_ref = make_port_ref(instance_id, ports[1].get("id"))

        if component_id == "wire":
            union_find.union(first_ref, second_ref)
        elif component_id == "switch" and bool(switch_states.get(instance_id, True)):
            union_find.union(first_ref, second_ref)

    port_nodes = {}
    for component in components:
        for port in component.get("ports") or []:
            port_ref = make_port_ref(component.get("instanceId"), port.get("id"))
            port_nodes[port_ref] = union_find.find(port_ref)
    return port_nodes


def build_elements(
    components: list[dict[str, Any]],
    port_nodes: dict[str, str],
    source_scale: float,
) -> list[Element]:
    elements: list[Element] = []

    for component in components:
        ports = component.get("ports") or []
        if len(ports) < 2:
            continue

        component_id = component.get("id")
        instance_id = component.get("instanceId")
        node_a = port_nodes.get(make_port_ref(instance_id, ports[0].get("id")))
        node_b = port_nodes.get(make_port_ref(instance_id, ports[1].get("id")))
        if not node_a or not node_b:
            continue

        common_kwargs = {
            "instance_id": instance_id,
            "component_id": component_id,
            "name": component.get("name", instance_id),
            "node_a": node_a,
            "node_b": node_b,
            "port_a": ports[0].get("id"),
            "port_b": ports[1].get("id"),
        }

        if component_id == "battery":
            elements.append(
                Element(
                    kind="vsource",
                    value=get_component_parameter(component, "voltage", DEFAULT_BATTERY_VOLTAGE)
                    * source_scale,
                    **common_kwargs,
                )
            )
        elif component_id == "led":
            elements.append(
                Element(
                    kind="led",
                    value=get_component_parameter(
                        component,
                        "resistance",
                        DEFAULT_COMPONENT_PARAMETERS["led"]["resistance"],
                    ),
                    forward_voltage=get_component_parameter(
                        component,
                        "forwardVoltage",
                        DEFAULT_COMPONENT_PARAMETERS["led"]["forwardVoltage"],
                    ),
                    **common_kwargs,
                )
            )
        elif component_id in {"resistor", "lamp", "motor", "fan", "buzzer", "fuse"}:
            elements.append(
                Element(
                    kind="resistor",
                    value=get_component_parameter(
                        component,
                        "resistance",
                        DEFAULT_COMPONENT_PARAMETERS.get(component_id, {}).get("resistance", 100.0),
                    ),
                    **common_kwargs,
                )
            )
        elif component_id == "capacitor":
            elements.append(
                Element(
                    kind="capacitor",
                    value=get_component_parameter(
                        component,
                        "capacitance",
                        DEFAULT_COMPONENT_PARAMETERS["capacitor"]["capacitance"],
                    ),
                    **common_kwargs,
                )
            )

    return elements


def find_active_nodes(elements: list[Element], battery_nodes: list[str]) -> set[str]:
    if not battery_nodes:
        return set()

    adjacency: dict[str, set[str]] = {}
    for element in elements:
        adjacency.setdefault(element.node_a, set()).add(element.node_b)
        adjacency.setdefault(element.node_b, set()).add(element.node_a)

    queue = deque(node for node in battery_nodes if node in adjacency)
    visited = set(queue)

    while queue:
        node = queue.popleft()
        for neighbor in adjacency.get(node, ()):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)

    return visited


def stamp_resistor(
    matrix: list[list[float]],
    node_index: dict[str, int],
    ground_node: str,
    node_a: str,
    node_b: str,
    resistance: float,
) -> None:
    if resistance <= 0:
        raise ValueError("Invalid resistance value.")

    conductance = 1.0 / resistance
    slot_a = node_slot(node_index, ground_node, node_a)
    slot_b = node_slot(node_index, ground_node, node_b)

    if slot_a is not None:
        matrix[slot_a][slot_a] += conductance
    if slot_b is not None:
        matrix[slot_b][slot_b] += conductance
    if slot_a is not None and slot_b is not None:
        matrix[slot_a][slot_b] -= conductance
        matrix[slot_b][slot_a] -= conductance


def stamp_led_on(
    matrix: list[list[float]],
    rhs: list[float],
    node_index: dict[str, int],
    ground_node: str,
    node_a: str,
    node_b: str,
    series_resistance: float,
    forward_voltage: float,
) -> None:
    resistance = max(series_resistance, 1.0)
    stamp_resistor(matrix, node_index, ground_node, node_a, node_b, resistance)
    conductance = 1.0 / resistance
    stamp_current_source(
        rhs,
        node_index,
        ground_node,
        node_b,
        node_a,
        conductance * max(forward_voltage, 0.0),
    )


def stamp_current_source(
    rhs: list[float],
    node_index: dict[str, int],
    ground_node: str,
    node_a: str,
    node_b: str,
    current: float,
) -> None:
    if node_a != ground_node and node_a in node_index:
        rhs[node_index[node_a]] -= current
    if node_b != ground_node and node_b in node_index:
        rhs[node_index[node_b]] += current


def stamp_voltage_source(
    matrix: list[list[float]],
    rhs: list[float],
    node_index: dict[str, int],
    source_index: dict[str, int],
    ground_node: str,
    element: Element,
) -> None:
    row = len(node_index) + source_index[element.instance_id]

    if element.node_a != ground_node and element.node_a in node_index:
        matrix[node_index[element.node_a]][row] += 1.0
        matrix[row][node_index[element.node_a]] += 1.0
    if element.node_b != ground_node and element.node_b in node_index:
        matrix[node_index[element.node_b]][row] -= 1.0
        matrix[row][node_index[element.node_b]] -= 1.0

    rhs[row] += element.value


def solve_linear_system(matrix: list[list[float]], rhs: list[float]) -> list[float]:
    size = len(rhs)
    augmented = [row[:] + [rhs[index]] for index, row in enumerate(matrix)]

    for pivot_index in range(size):
        pivot_row = max(
            range(pivot_index, size),
            key=lambda row_index: abs(augmented[row_index][pivot_index]),
        )
        if abs(augmented[pivot_row][pivot_index]) < 1e-10:
            raise ValueError("Circuit solution failed because the matrix is singular.")

        if pivot_row != pivot_index:
            augmented[pivot_index], augmented[pivot_row] = (
                augmented[pivot_row],
                augmented[pivot_index],
            )

        pivot_value = augmented[pivot_index][pivot_index]
        for column_index in range(pivot_index, size + 1):
            augmented[pivot_index][column_index] /= pivot_value

        for row_index in range(size):
            if row_index == pivot_index:
                continue
            factor = augmented[row_index][pivot_index]
            if abs(factor) < 1e-12:
                continue
            for column_index in range(pivot_index, size + 1):
                augmented[row_index][column_index] -= (
                    factor * augmented[pivot_index][column_index]
                )

    return [augmented[row_index][size] for row_index in range(size)]


def pick_probe(component_results: list[dict[str, Any]]) -> dict[str, Any] | None:
    for component_id in PROBE_ORDER:
        for item in component_results:
            if item["componentId"] == component_id:
                return item
    for item in component_results:
        if item["kind"] not in {"vsource", "capacitor"}:
            return item
    return None


def build_metrics(result: dict[str, Any]) -> list[dict[str, Any]]:
    metrics = [
        {"label": "Supply voltage", "value": result["summaryValues"]["supplyVoltage"], "unit": "V"},
        {"label": "Supply current", "value": result["summaryValues"]["supplyCurrent"], "unit": "A"},
    ]

    probe = result.get("probe")
    if probe:
        metrics.extend(
            [
                {"label": f"{probe['name']} voltage", "value": probe["voltage"], "unit": "V"},
                {"label": f"{probe['name']} current", "value": probe["current"], "unit": "A"},
                {"label": f"{probe['name']} power", "value": probe["power"], "unit": "W"},
            ]
        )

    return metrics


def dedupe_list(values: list[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def make_port_ref(instance_id: str | None, port_id: str | None) -> str:
    return f"{instance_id}:{port_id}"


def node_slot(node_index: dict[str, int], ground_node: str, node_name: str) -> int | None:
    if node_name == ground_node:
        return None
    return node_index.get(node_name)


def get_component_parameter(component: dict[str, Any], key: str, fallback: float) -> float:
    parameters = component.get("parameters") or {}
    raw_value = parameters.get(key, fallback)
    try:
        numeric_value = float(raw_value)
    except (TypeError, ValueError):
        return fallback

    if not math.isfinite(numeric_value) or numeric_value <= 0:
        return fallback

    return numeric_value
