"""Context-engine discovery: a plugin's directory need not match the engine's name.

Two regressions this covers, both of which silently fell back to the built-in compressor:

* ``_is_context_engine_dir`` read only the first 8 KB of ``__init__.py``, so a plugin whose
  ``register_context_engine`` call sits further down was not recognised as an engine at all.
* ``find_engine_dir`` looked for a directory literally named after the engine, so a plugin
  installed as ``hermes-lcm`` but registering the engine ``lcm`` was never resolved.
"""

from __future__ import annotations

import textwrap

import pytest

from plugins import context_engine as ce


def _make_engine_plugin(root, dirname: str, *, padding: int = 0, engine_name: str = "lcm",
                        manifest_name: str | None = None):
    """A minimal user plugin dir whose registration call sits ``padding`` bytes in."""
    plugin_dir = root / dirname
    plugin_dir.mkdir(parents=True)
    body = textwrap.dedent(
        f'''
        """Minimal engine plugin for the test."""

        def register(ctx):
            ctx.register_context_engine(object())
        '''
    )
    prefix = "# padding\n" * (padding // 10) if padding else ""
    (plugin_dir / "__init__.py").write_text(prefix + body, encoding="utf-8")
    (plugin_dir / "plugin.yaml").write_text(
        f"name: {manifest_name or dirname}\nversion: 0.0.1\ndescription: {engine_name}\n",
        encoding="utf-8",
    )
    return plugin_dir


@pytest.fixture()
def user_plugins(tmp_path, monkeypatch):
    """Point ``user_plugins_dir`` at a tmp dir so the real home is never consulted."""
    root = tmp_path / "plugins"
    root.mkdir()
    monkeypatch.setattr(ce._loader, "user_plugins_dir", lambda: root)
    return root


class _FakeEngine:
    """Stands in for a loaded engine: only ``name`` is consulted by discovery."""

    def __init__(self, name: str):
        self.name = name


def test_registration_call_past_the_old_8kb_window_is_found(tmp_path, user_plugins):
    plugin_dir = _make_engine_plugin(user_plugins, "hermes-lcm", padding=12_000)
    assert ce._is_context_engine_dir(plugin_dir) is True


def test_engine_resolves_when_directory_name_differs(tmp_path, user_plugins, monkeypatch):
    # Installed as hermes-lcm, selected as lcm: the engine's own name is what decides.
    _make_engine_plugin(user_plugins, "hermes-lcm", manifest_name="hermes-lcm")
    monkeypatch.setattr(ce, "_load_engine_from_dir", lambda p: _FakeEngine("lcm"))
    assert ce.find_engine_dir("lcm") is not None


def test_engine_under_another_name_is_not_returned(tmp_path, user_plugins, monkeypatch):
    # A different engine must not be loaded for a name it does not answer to.
    _make_engine_plugin(user_plugins, "hermes-lcm", manifest_name="hermes-lcm")
    monkeypatch.setattr(ce, "_load_engine_from_dir", lambda p: _FakeEngine("lcm"))
    assert ce.find_engine_dir("lcm-x") is None


def test_engine_that_fails_to_load_is_not_matched(tmp_path, user_plugins, monkeypatch):
    _make_engine_plugin(user_plugins, "hermes-lcm", manifest_name="hermes-lcm")

    def boom(_path):
        raise RuntimeError("no engine here")

    monkeypatch.setattr(ce, "_load_engine_from_dir", boom)
    assert ce.find_engine_dir("lcm") is None


def test_direct_directory_name_still_wins(tmp_path, user_plugins):
    direct = _make_engine_plugin(user_plugins, "lcm")
    other = _make_engine_plugin(user_plugins, "aaa-other-engine")
    assert ce.find_engine_dir("lcm") == direct
    assert other != direct


def test_absent_engine_still_returns_none(tmp_path, user_plugins):
    _make_engine_plugin(user_plugins, "hermes-lcm")
    assert ce.find_engine_dir("not-an-engine") is None


def test_directory_without_the_contract_is_not_an_engine(tmp_path, user_plugins):
    plain = user_plugins / "plain-plugin"
    plain.mkdir()
    (plain / "__init__.py").write_text("def register(ctx):\n    pass\n", encoding="utf-8")
    assert ce._is_context_engine_dir(plain) is False
    assert ce.find_engine_dir("plain-plugin") is None
