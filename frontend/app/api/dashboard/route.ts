import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://backend:3001';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string | string[]>> }
) {
  const resolvedParams = await params;
  const path = Array.isArray(resolvedParams.path) ? resolvedParams.path : [resolvedParams.path as string];
  const pathString = path.join('/');
  const searchParams = request.nextUrl.searchParams.toString();
  const query = searchParams ? `?${searchParams}` : '';

  const backendUrl = `${API_URL}/api/${pathString}${query}`;

  try {
    const response = await fetch(backendUrl, {
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Backend unavailable' },
      { status: 503 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string | string[]>> }
) {
  const resolvedParams = await params;
  const path = Array.isArray(resolvedParams.path) ? resolvedParams.path : [resolvedParams.path as string];
  const pathString = path.join('/');
  const body = await request.json();

  const backendUrl = `${API_URL}/api/${pathString}`;

  try {
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Backend unavailable' },
      { status: 503 }
    );
  }
}
