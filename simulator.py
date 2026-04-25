from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import math
from typing import Any


DEFAULT_BATTERY_VOLTAGE = 5.0
DEFAULT_SAMPLE_COUNT = 121
DEFAULT_DURATION = 0.12
DEFAULT_EVENT_TIME = 0.04

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

PROBE_ORDER = ("led", "lamp", "resistor", "motor", "fan", "buzzer", "capacitor", "fuse")


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

    batteries = [component for component in components if component.get("id") == "battery"]
    if not batteries:
        return {
            "ok": False,
            "error": "缺少电池，Python 仿真器无法建立电源边界条件。",
        }

    final_result = solve_snapshot(
        components, connections, final_switch_states, 1.0, {}
    )
    if not final_result["ok"]:
        return final_result

    all_switches = [component for component in components if component.get("id") == "switch"]
    initial_switch_states = dict(final_switch_states)
    source_scale_before = 0.0
    source_scale_after = 1.0

    if all_switches:
        for switch in all_switches:
            instance_id = switch.get("instanceId")
            initial_switch_states[instance_id] = not bool(final_switch_states.get(instance_id, True))
        source_scale_before = 1.0

    samples = []
    capacitor_voltages: dict[str, float] = {}
    dt = DEFAULT_DURATION / max(DEFAULT_SAMPLE_COUNT - 1, 1)

    for sample_index in range(DEFAULT_SAMPLE_COUNT):
        ratio = sample_index / (DEFAULT_SAMPLE_COUNT - 1)
        time_value = round(DEFAULT_DURATION * ratio, 6)
        before_event = time_value < DEFAULT_EVENT_TIME
        switch_state = initial_switch_states if before_event else final_switch_states
        source_scale = source_scale_before if before_event else source_scale_after

        snapshot = solve_snapshot(
            components, connections, switch_state, source_scale,
            capacitor_voltages, dt
        )

        if not snapshot["ok"]:
            return snapshot

        capacitor_voltages = snapshot.get("capacitorVoltages", {})

        samples.append(
            {
                "time": time_value,
                "supplyVoltage": snapshot["summaryValues"]["supplyVoltage"],
                "supplyCurrent": snapshot["summaryValues"]["supplyCurrent"],
                "probeVoltage": snapshot["summaryValues"]["probeVoltage"],
                "probeCurrent": snapshot["summaryValues"]["probeCurrent"],
            }
        )

    waveform_series = [
        {
            "key": "supplyVoltage",
            "label": "电源电压",
            "unit": "V",
            "color": "#d95f23",
            "values": [sample["supplyVoltage"] for sample in samples],
        },
        {
            "key": "supplyCurrent",
            "label": "总电流",
            "unit": "A",
            "color": "#235d52",
            "values": [sample["supplyCurrent"] for sample in samples],
        },
    ]

    probe_label = final_result["probe"]["name"] if final_result["probe"] else "主负载"
    waveform_series.extend(
        [
            {
                "key": "probeVoltage",
                "label": f"{probe_label} 电压",
                "unit": "V",
                "color": "#0d7b52",
                "values": [sample["probeVoltage"] for sample in samples],
            },
            {
                "key": "probeCurrent",
                "label": f"{probe_label} 电流",
                "unit": "A",
                "color": "#7c3aed",
                "values": [sample["probeCurrent"] for sample in samples],
            },
        ]
    )

    summary_lines = [
        "Python 结点分析已完成。",
        "波形展示的是当前开关状态对应的一次切换响应。",
    ]
    if final_result["ignoredComponents"]:
        summary_lines.append(f"忽略了 {len(final_result['ignoredComponents'])} 个未接入电源回路的元件。")

    if final_result.get("warnings"):
        summary_lines.extend(final_result["warnings"])

    return {
        "ok": True,
        "solver": "python-mna-enhanced",
        "summary": " ".join(summary_lines),
        "warnings": final_result.get("warnings", []),
        "metrics": build_metrics(final_result),
        "waveform": {
            "time": [sample["time"] for sample in samples],
            "series": waveform_series,
            "eventTime": DEFAULT_EVENT_TIME,
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
    dt: float = None,
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
            "error": "当前电路没有接入可求解的电源回路。",
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
            "error": "没有检测到可用于仿真的电压源。",
        }

    ground_node = sources[0].node_b
    node_names = sorted(node for node in active_nodes if node != ground_node)
    node_index = {node_name: index for index, node_name in enumerate(node_names)}
    source_index = {
        element.instance_id: index for index, element in enumerate(sources)
    }

    matrix_size = len(node_names) + len(sources)
    if matrix_size == 0:
        return {
            "ok": False,
            "error": "当前电路没有可求解变量。",
        }

    matrix = [[0.0 for _ in range(matrix_size)] for _ in range(matrix_size)]
    rhs = [0.0 for _ in range(matrix_size)]

    component_results = []
    warnings = []
    new_capacitor_voltages = dict(capacitor_voltages)

    for element in active_elements:
        if element.kind == "resistor":
            stamp_resistor(matrix, node_index, ground_node, element.node_a, element.node_b, element.value)
        elif element.kind == "led":
            led_series_resistance = element.value
            if led_series_resistance <= 0:
                led_series_resistance = 1.0

            effective_resistance = led_series_resistance
            stamp_resistor(
                matrix, node_index, ground_node,
                element.node_a, element.node_b, effective_resistance
            )
        elif element.kind == "capacitor":
            if source_scale <= 0:
                continue

            capacitance = element.value
            if capacitance <= 0:
                capacitance = 1e-6

            conductance = capacitance / dt
            previous_voltage = capacitor_voltages.get(element.instance_id, 0.0)

            stamp_resistor(
                matrix, node_index, ground_node,
                element.node_a, element.node_b, 1.0 / conductance
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
        element.instance_id: solution[len(node_names) + source_offset]
        for element, source_offset in ((source, source_index[source.instance_id]) for source in sources)
    }

    for element in active_elements:
        voltage = node_voltages.get(element.node_a, 0.0) - node_voltages.get(element.node_b, 0.0)
        current = 0.0
        power = 0.0

        if element.kind == "resistor":
            current = voltage / element.value
            power = voltage * current
        elif element.kind == "led":
            forward_voltage = element.forward_voltage
            series_resistance = element.value
            if series_resistance <= 0:
                series_resistance = 1.0

            actual_current = 0.0
            effective_voltage = 0.0

            if voltage > forward_voltage:
                actual_current = (voltage - forward_voltage) / series_resistance
                effective_voltage = forward_voltage
            elif voltage < -forward_voltage:
                actual_current = 0.0
                effective_voltage = 0.0
                warnings.append(f"{element.name} 反向偏置，电流截止。")
            else:
                actual_current = 0.0
                effective_voltage = 0.0

            current = actual_current
            power = effective_voltage * actual_current
            voltage = effective_voltage

        elif element.kind == "capacitor":
            capacitance = element.value
            if capacitance > 0 and dt > 0:
                prev_v = capacitor_voltages.get(element.instance_id, 0.0)
                new_v = voltage
                current = capacitance * (new_v - prev_v) / dt
                power = voltage * current

                new_capacitor_voltages[element.instance_id] = new_v
            else:
                current = 0.0
                power = 0.0

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
                "rawVoltage": voltage,
            }
        )

    led_elements = [e for e in active_elements if e.kind == "led"]
    if led_elements:
        led = led_elements[0]
        forward_voltage = led.forward_voltage

        total_resistance = 0.0
        for element in active_elements:
            if element.kind == "resistor":
                total_resistance += element.value
            elif element.kind == "led":
                total_resistance += element.value

        first_source = sources[0]
        supply_voltage = abs(
            node_voltages.get(first_source.node_a, 0.0) - node_voltages.get(first_source.node_b, 0.0)
        )

        led_original_voltage = abs(node_voltages.get(led.node_a, 0.0) - node_voltages.get(led.node_b, 0.0))
        led_is_forward = led_original_voltage > forward_voltage

        if led_is_forward and total_resistance > 0:
            correct_current = (supply_voltage - forward_voltage) / total_resistance

            for result in component_results:
                element = next((e for e in active_elements if e.instance_id == result["instanceId"]), None)
                if not element:
                    continue

                if element.kind == "vsource":
                    result["current"] = round(abs(correct_current), 6)
                    result["power"] = round(abs(result["voltage"] * correct_current), 6)
                elif element.kind == "resistor":
                    resistance = element.value
                    result["current"] = round(abs(correct_current), 6)
                    result["voltage"] = round(abs(correct_current * resistance), 6)
                    result["power"] = round(abs(result["voltage"] * correct_current), 6)
                elif element.kind == "led":
                    result["current"] = round(abs(correct_current), 6)
                    result["voltage"] = round(abs(forward_voltage), 6)
                    result["power"] = round(abs(forward_voltage * correct_current), 6)

    probe = pick_probe(component_results)
    supply_voltage = 0.0
    supply_current = 0.0

    first_source = sources[0]
    supply_voltage = abs(
        node_voltages.get(first_source.node_a, 0.0) - node_voltages.get(first_source.node_b, 0.0)
    )

    source_result = next((r for r in component_results if r["instanceId"] == first_source.instance_id), None)
    if source_result:
        supply_current = abs(source_result["current"])
    else:
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
                    value=get_component_parameter(component, "voltage", DEFAULT_BATTERY_VOLTAGE) * source_scale,
                    forward_voltage=0.0,
                    **common_kwargs,
                )
            )
        elif component_id == "led":
            resistance = get_component_parameter(
                component,
                "resistance",
                DEFAULT_COMPONENT_PARAMETERS["led"]["resistance"],
            )
            forward_voltage = get_component_parameter(
                component,
                "forwardVoltage",
                DEFAULT_COMPONENT_PARAMETERS["led"]["forwardVoltage"],
            )
            elements.append(
                Element(
                    kind="led",
                    value=resistance,
                    forward_voltage=forward_voltage,
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
                    forward_voltage=0.0,
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
                    forward_voltage=0.0,
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
        raise ValueError("检测到非法电阻值。")

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
        pivot_row = max(range(pivot_index, size), key=lambda row_index: abs(augmented[row_index][pivot_index]))
        if abs(augmented[pivot_row][pivot_index]) < 1e-10:
            raise ValueError("电路无法求解，存在悬空节点或理想电源短路。")

        if pivot_row != pivot_index:
            augmented[pivot_index], augmented[pivot_row] = augmented[pivot_row], augmented[pivot_index]

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
                augmented[row_index][column_index] -= factor * augmented[pivot_index][column_index]

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
        {"label": "电源电压", "value": result["summaryValues"]["supplyVoltage"], "unit": "V"},
        {"label": "总电流", "value": result["summaryValues"]["supplyCurrent"], "unit": "A"},
    ]

    probe = result.get("probe")
    if probe:
        metrics.extend(
            [
                {"label": f"{probe['name']} 电压", "value": probe["voltage"], "unit": "V"},
                {"label": f"{probe['name']} 电流", "value": probe["current"], "unit": "A"},
                {"label": f"{probe['name']} 功耗", "value": probe["power"], "unit": "W"},
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
