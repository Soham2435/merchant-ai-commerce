import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        {
          success: false,
          authenticated: false,
          error: userError?.message ?? "No authenticated user",
        },
        { status: 401 }
      );
    }

    const { data: memberships, error: membershipError } = await supabase
      .from("merchant_members")
      .select("merchant_id, role")
      .limit(10);

    if (membershipError) {
      return NextResponse.json(
        {
          success: false,
          authenticated: true,
          membership: false,
          error: membershipError.message,
          code: membershipError.code,
        },
        { status: 500 }
      );
    }

    const merchantIds = memberships?.map((membership) => membership.merchant_id) ?? [];

    if (merchantIds.length === 0) {
      return NextResponse.json({
        success: false,
        authenticated: true,
        membership: false,
        error: "Authenticated user has no merchant membership.",
      });
    }

    const { data: merchants, error: merchantError } = await supabase
      .from("merchants")
      .select("id, name")
      .in("id", merchantIds);

    if (merchantError) {
      return NextResponse.json(
        {
          success: false,
          authenticated: true,
          membership: true,
          merchant: false,
          error: merchantError.message,
          code: merchantError.code,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      authenticated: true,
      membership: true,
      merchant: true,
      merchants: merchants ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}