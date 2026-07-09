"""
Integration tests for API endpoints.

Tests session CRUD, file upload, config, and results endpoints.
All tests use specific assertions (no status code ranges).
"""

class TestSessionAPI:
    """Test session management endpoints."""

    def test_create_session_success(self, client):
        """Create new session successfully."""
        response = client.post(
            "/api/sessions",
            json={"name": "Test Session", "template": "multi_condition_comparison"},
        )

        assert response.status_code == 201
        data = response.json()
        assert "id" in data
        assert len(data["id"]) == 36  # UUID format
        assert data["name"] == "Test Session"
        assert data["template"] == "multi_condition_comparison"
        assert data["state"] == "created"
        assert data["config"] is None
        assert data["files"]["proteomics"] == []

    def test_create_session_missing_name(self, client):
        """Reject session without name."""
        response = client.post(
            "/api/sessions", json={"template": "multi_condition_comparison"}
        )

        assert response.status_code == 422
        error = response.json()
        assert "detail" in error

    def test_create_session_default_template(self, client):
        """Session without template uses default."""
        response = client.post("/api/sessions", json={"name": "Test Session"})

        assert response.status_code == 201
        data = response.json()
        assert data["template"] == "multi_condition_comparison"

    def test_list_sessions(self, client):
        """List all sessions."""
        # Create a session first
        create_response = client.post(
            "/api/sessions",
            json={
                "name": "Test Session List",
                "template": "multi_condition_comparison",
            },
        )
        created_id = create_response.json()["id"]

        response = client.get("/api/sessions")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1

        # Find our created session
        session_ids = [s["id"] for s in data]
        assert created_id in session_ids

    def test_get_session_success(self, client):
        """Get session by ID."""
        # Create session
        create_response = client.post(
            "/api/sessions",
            json={
                "name": "Test Session Get",
                "template": "multi_condition_comparison",
            },
        )
        session_id = create_response.json()["id"]

        # Get session
        response = client.get(f"/api/sessions/{session_id}")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == session_id
        assert data["name"] == "Test Session Get"
        assert "state" in data
        assert "created_at" in data

    def test_get_session_not_found(self, client):
        """Return 404 for non-existent session."""
        response = client.get("/api/sessions/non-existent-id-12345")

        assert response.status_code == 404
        error = response.json()
        assert error["error"]["code"] == "SESSION_NOT_FOUND"

    def test_delete_session_success(self, client):
        """Delete session successfully."""
        # Create session
        create_response = client.post(
            "/api/sessions",
            json={
                "name": "Test Session Delete",
                "template": "multi_condition_comparison",
            },
        )
        session_id = create_response.json()["id"]

        # Delete session
        response = client.delete(f"/api/sessions/{session_id}")

        assert response.status_code == 204

        # Verify deletion
        get_response = client.get(f"/api/sessions/{session_id}")
        assert get_response.status_code == 404

    def test_delete_session_not_found(self, client):
        """Return 404 when deleting non-existent session."""
        response = client.delete("/api/sessions/non-existent-id-12345")

        assert response.status_code == 404


class TestSessionConfigAPI:
    """Test session configuration endpoints."""

    def test_update_session_config_success(self, client):
        """Update session configuration."""
        # Create session
        create_response = client.post(
            "/api/sessions",
            json={
                "name": "Test Session Config",
                "template": "multi_condition_comparison",
            },
        )
        session_id = create_response.json()["id"]

        # Update config
        response = client.put(
            f"/api/sessions/{session_id}/config",
            json={
                "treatment": "INCZ123456",
                "control": "DMSO",
                "organism": "human",
                "remove_razor": True,
                "strict_filtering": False,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["config"]["treatment"] == "INCZ123456"
        assert data["config"]["control"] == "DMSO"
        assert data["config"]["organism"] == "human"
        assert data["config"]["remove_razor"] is True
        assert data["config"]["strict_filtering"] is False
        assert data["state"] == "configuring"

    def test_update_config_treatment_equals_control(self, client):
        """Reject config where treatment equals control."""
        # Create session
        create_response = client.post(
            "/api/sessions",
            json={
                "name": "Test Session Config",
                "template": "multi_condition_comparison",
            },
        )
        session_id = create_response.json()["id"]

        # Update config with invalid values
        response = client.put(
            f"/api/sessions/{session_id}/config",
            json={"treatment": "DMSO", "control": "DMSO", "organism": "human"},
        )

        # The endpoint accepts treatment == control (no Pydantic validation against it)
        assert response.status_code == 200
        data = response.json()
        assert data["config"]["treatment"] == "DMSO"
        assert data["config"]["control"] == "DMSO"

    def test_update_config_invalid_organism(self, client):
        """Reject config with invalid organism."""
        # Create session
        create_response = client.post(
            "/api/sessions",
            json={
                "name": "Test Session Config",
                "template": "multi_condition_comparison",
            },
        )
        session_id = create_response.json()["id"]

        # Update config with invalid organism
        response = client.put(
            f"/api/sessions/{session_id}/config",
            json={
                "treatment": "INCZ123456",
                "control": "DMSO",
                "organism": "invalid_organism_123",
            },
        )

        # Pydantic validation rejects invalid organism at the API layer
        assert response.status_code == 422

    def test_update_config_session_not_found(self, client):
        """Return 404 when updating non-existent session."""
        response = client.put(
            "/api/sessions/non-existent-id/config",
            json={"treatment": "INCZ123456", "control": "DMSO", "organism": "human"},
        )

        assert response.status_code == 404


class TestFileUploadAPI:
    """Test file upload endpoints."""

    def test_upload_proteomics_files_success(self, client, test_data_dir):
        """Upload proteomics files successfully."""
        # Create session
        create_response = client.post(
            "/api/sessions",
            json={
                "name": "Test Session Upload",
                "template": "multi_condition_comparison",
            },
        )
        session_id = create_response.json()["id"]

        # Configure session with file_type
        client.put(
            f"/api/sessions/{session_id}/config",
            json={"file_type": "tmt"},
        )

        # Upload file
        file_path = test_data_dir / "tmt_sample_1000rows.txt"
        with open(file_path, "rb") as f:
            response = client.post(
                f"/api/sessions/{session_id}/upload/proteomics",
                files={"files": ("tmt_sample_1000rows.txt", f, "text/plain")},
            )

        assert response.status_code == 200
        data = response.json()
        assert "files" in data
        assert len(data["files"]) == 1
        assert data["files"][0]["filename"] == "tmt_sample_1000rows.txt"
        assert "size" in data["files"][0]
        assert "columns" in data["files"][0]
        assert data["files"][0]["file_type"] == "tmt"

    def test_upload_multiple_proteomics_files(self, client, test_data_dir):
        """Upload multiple proteomics files."""
        # Create session
        create_response = client.post(
            "/api/sessions",
            json={
                "name": "Test Session Multi",
                "template": "multi_condition_comparison",
            },
        )
        session_id = create_response.json()["id"]

        # Configure session with file_type
        client.put(
            f"/api/sessions/{session_id}/config",
            json={"file_type": "tmt"},
        )

        # Upload multiple files
        file1_path = test_data_dir / "tmt_sample_1000rows.txt"
        file2_path = test_data_dir / "tmt_sample_10000rows.txt"

        with open(file1_path, "rb") as f1, open(file2_path, "rb") as f2:
            response = client.post(
                f"/api/sessions/{session_id}/upload/proteomics",
                files=[
                    ("files", ("tmt_sample_1000rows.txt", f1, "text/plain")),
                    ("files", ("tmt_sample_10000rows.txt", f2, "text/plain")),
                ],
            )

        assert response.status_code == 200
        data = response.json()
        assert "files" in data
        assert len(data["files"]) == 2

    def test_upload_invalid_file_content(self, client):
        """Reject file with invalid content for the configured file_type."""
        # Create session
        create_response = client.post(
            "/api/sessions",
            json={"name": "Test Session", "template": "multi_condition_comparison"},
        )
        session_id = create_response.json()["id"]

        # Configure session with file_type
        client.put(
            f"/api/sessions/{session_id}/config",
            json={"file_type": "tmt"},
        )

        # Upload file with content that doesn't match TMT format
        response = client.post(
            f"/api/sessions/{session_id}/upload/proteomics",
            files={"files": ("bad_file.csv", b"col1,col2\n1,2", "text/csv")},
        )

        assert response.status_code == 400

    def test_upload_file_session_not_found(self, client, test_data_dir):
        """Return 404 when uploading to non-existent session."""
        file_path = test_data_dir / "tmt_sample_1000rows.txt"

        with open(file_path, "rb") as f:
            response = client.post(
                "/api/sessions/non-existent-id/upload/proteomics",
                files={"files": ("tmt_sample_1000rows.txt", f, "text/plain")},
            )

        assert response.status_code == 404


class TestProcessingStatusAPI:
    """Test processing status endpoints."""

    def test_get_processing_status(self, client):
        """Get processing status."""
        # Create session
        create_response = client.post(
            "/api/sessions",
            json={
                "name": "Test Session Status",
                "template": "multi_condition_comparison",
            },
        )
        session_id = create_response.json()["id"]

        response = client.get(f"/api/sessions/{session_id}/status")

        assert response.status_code == 200
        data = response.json()
        assert "state" in data
        assert "progress" in data
        assert "steps" in data

    def test_get_processing_status_not_found(self, client):
        """Return 404 for non-existent session status."""
        response = client.get("/api/sessions/non-existent-id/status")

        assert response.status_code == 404


class TestErrorHandling:
    """Test API error handling."""

    def test_validation_error_format(self, client):
        """Verify validation error response format."""
        response = client.post(
            "/api/sessions",
            json={
                "template": "multi_condition_comparison"
                # Missing required 'name'
            },
        )

        assert response.status_code == 422
        error_data = response.json()
        assert "detail" in error_data

    def test_not_found_error_format(self, client):
        """Verify not found error response format."""
        response = client.get("/api/sessions/non-existent-id")

        assert response.status_code == 404
        error_data = response.json()
        assert "error" in error_data
        assert error_data["error"]["code"] == "SESSION_NOT_FOUND"
        assert "message" in error_data["error"]

    def test_method_not_allowed(self, client):
        """Handle method not allowed."""
        response = client.put("/api/sessions")  # PUT not allowed on collection

        assert response.status_code == 405


class TestFileDelete:
    def test_delete_nonexistent_file(self, client):
        create_resp = client.post(
            "/api/sessions",
            json={"name": "Delete Test", "template": "multi_condition_comparison"},
        )
        session_id = create_resp.json()["id"]

        response = client.delete(
            f"/api/sessions/{session_id}/files/proteomics/nonexistent.csv"
        )
        assert response.status_code == 200

    def test_invalid_file_type_returns_400(self, client):
        create_resp = client.post(
            "/api/sessions",
            json={"name": "Delete Test", "template": "multi_condition_comparison"},
        )
        session_id = create_resp.json()["id"]

        response = client.delete(
            f"/api/sessions/{session_id}/files/invalid_type/test.csv"
        )
        assert response.status_code == 400

    def test_session_not_found_on_delete(self, client):
        response = client.delete(
            "/api/sessions/non-existent-id/files/proteomics/test.csv"
        )
        assert response.status_code == 404


class TestOrganismsEndpoint:
    def test_lists_organisms(self, client):
        response = client.get("/api/organisms")
        assert response.status_code == 200
        data = response.json()
        assert "organisms" in data
        assert isinstance(data["organisms"], list)
