<?php
header('Content-Type: application/json; charset=utf-8');

$store = __DIR__ . '/leaderboard.json';

function read_leaderboard($store) {
    if (!file_exists($store)) {
        file_put_contents($store, json_encode([], JSON_PRETTY_PRINT));
        return [];
    }

    $content = file_get_contents($store);
    $entries = json_decode($content, true);
    if (!is_array($entries)) {
        return [];
    }
    return $entries;
}

function write_leaderboard($store, $entries) {
    $json = json_encode($entries, JSON_PRETTY_PRINT);
    if ($json === false) {
        return false;
    }
    return file_put_contents($store, $json) !== false;
}

$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'GET') {
    $entries = read_leaderboard($store);
    echo json_encode($entries);
    exit;
}

if ($method === 'POST') {
    $body = file_get_contents('php://input');
    $entries = json_decode($body, true);
    if (!is_array($entries)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid leaderboard payload']);
        exit;
    }

    if (!write_leaderboard($store, $entries)) {
        http_response_code(500);
        echo json_encode(['error' => 'Unable to write leaderboard']);
        exit;
    }

    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
